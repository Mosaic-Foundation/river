// The identity host's queries. Every function takes the Db of a forIdentity() transaction, whose
// settings (app.person_id, app.auth_request_id) decide which rows it can reach; the lookups
// before a person is known go through the schema's SECURITY DEFINER functions, which return an
// id and nothing else. Times come from the identity clock (./clock.ts), never the database's now().
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/context.js";

export const AUTH_REQUEST_TTL_MS = 10 * 60_000;
export const TOKEN_TTL_MS = { recover: 15 * 60_000, verify_email: 24 * 60 * 60_000 } as const;

export type RequestPurpose = "authorize" | "recover" | "change_email";
export type TokenPurpose = keyof typeof TOKEN_TTL_MS;

// ---------------------------------------------------------------------------------------------
// Random values

/** 32 random bytes, base64url: a WebAuthn challenge or an emailed token. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** A person's code: 8 random lowercase base32 characters (spec 3.2). */
export function randomCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) code += BASE32[byte & 31];
  return code;
}

// ---------------------------------------------------------------------------------------------
// Lookups before a person is known (run inside forIdentity({}))

async function lookupId(db: Db, fn: string, value: unknown): Promise<string | undefined> {
  const { rows } = await db.query<{ id: string | null }>(`SELECT ${fn}($1) AS id`, [value]);
  return rows[0]?.id ?? undefined;
}

export const lookups = {
  personByCredential: (db: Db, credentialId: string) => lookupId(db, "identity.person_by_credential", credentialId),
  personByCode: (db: Db, code: string) => lookupId(db, "identity.person_by_code", code),
  personForRecovery: (db: Db, email: string) => lookupId(db, "identity.person_for_recovery", email),
  personByToken: (db: Db, tokenHash: Buffer) => lookupId(db, "identity.person_by_token", tokenHash),
  async emailInUse(db: Db, email: string): Promise<boolean> {
    const { rows } = await db.query<{ used: boolean }>("SELECT identity.email_in_use($1) AS used", [email]);
    return rows[0]?.used === true;
  },
  async personCodes(db: Db): Promise<string[]> {
    const { rows } = await db.query<{ code: string }>("SELECT code FROM identity.person_codes() AS code");
    return rows.map((r) => r.code);
  },
};

// ---------------------------------------------------------------------------------------------
// auth_requests (inside forIdentity({ authRequestId }))

export interface AuthRequest {
  id: string;
  purpose: RequestPurpose;
  client_id: string | null;
  redirect_uri: string | null;
  state: string | null;
  nonce: string | null;
  person_id: string | null;
  pending: Record<string, string>;
  webauthn_challenge: string;
  expires_at: Date;
  used_at: Date | null;
}

export interface NewAuthRequest {
  id: string;
  purpose: RequestPurpose;
  client?: { clientId: string; redirectUri: string; state: string; nonce: string };
  personId?: string;
  pending?: Record<string, string>;
  challenge: string;
  now: Date;
}

export async function insertAuthRequest(db: Db, r: NewAuthRequest): Promise<void> {
  await db.query(
    `INSERT INTO identity.auth_requests
       (id, purpose, client_id, redirect_uri, state, nonce, person_id, pending, webauthn_challenge,
        created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      r.id,
      r.purpose,
      r.client?.clientId ?? null,
      r.client?.redirectUri ?? null,
      r.client?.state ?? null,
      r.client?.nonce ?? null,
      r.personId ?? null,
      JSON.stringify(r.pending ?? {}),
      r.challenge,
      r.now,
      new Date(r.now.getTime() + AUTH_REQUEST_TTL_MS),
    ],
  );
}

/** The request if it is unused and unexpired at `now`. */
export async function liveAuthRequest(db: Db, id: string, now: Date): Promise<AuthRequest | undefined> {
  const { rows } = await db.query<AuthRequest>(
    "SELECT * FROM identity.auth_requests WHERE id = $1 AND used_at IS NULL AND expires_at > $2",
    [id, now],
  );
  return rows[0];
}

export async function setChallenge(db: Db, id: string, challenge: string, pending: Record<string, string>): Promise<void> {
  await db.query(
    "UPDATE identity.auth_requests SET webauthn_challenge = $2, pending = $3 WHERE id = $1 AND used_at IS NULL",
    [id, challenge, JSON.stringify(pending)],
  );
}

/** Marks the request used; false if it was already used or has expired (spec 4.6: before signing). */
export async function consumeAuthRequest(db: Db, id: string, now: Date): Promise<boolean> {
  const { rowCount } = await db.query(
    "UPDATE identity.auth_requests SET used_at = $2 WHERE id = $1 AND used_at IS NULL AND expires_at > $2",
    [id, now],
  );
  return rowCount === 1;
}

// ---------------------------------------------------------------------------------------------
// People, passkeys and the DID log (inside forIdentity({ personId }))

export interface Person {
  id: string;
  code: string;
  did: string;
  scid: string;
  display_name: string | null;
  webauthn_user_id: Buffer;
  email: string;
  email_verified_at: Date | null;
}

export async function getPerson(db: Db, id: string, lock = false): Promise<Person | undefined> {
  const { rows } = await db.query<Person>(
    `SELECT id, code, did, scid, display_name, webauthn_user_id, email, email_verified_at
       FROM identity.people WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0];
}

export interface Passkey {
  id: string;
  person_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: string;
  transports: string[];
}

export async function getPasskey(db: Db, credentialId: string): Promise<Passkey | undefined> {
  const { rows } = await db.query<Passkey>(
    "SELECT id, person_id, credential_id, public_key, counter::text, transports FROM identity.passkeys WHERE credential_id = $1",
    [credentialId],
  );
  return rows[0];
}

export async function insertPasskey(
  db: Db,
  personId: string,
  credential: { id: string; publicKey: Uint8Array; counter: number; transports?: readonly string[] },
  now: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO identity.passkeys (person_id, credential_id, public_key, counter, transports, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [personId, credential.id, Buffer.from(credential.publicKey), credential.counter, credential.transports ?? [], now],
  );
}

export async function touchPasskey(db: Db, id: string, counter: number, now: Date): Promise<void> {
  await db.query("UPDATE identity.passkeys SET counter = $2, last_used_at = $3 WHERE id = $1", [id, counter, now]);
}

/** The person's did.jsonl lines, in version order. */
export async function readDidLog(db: Db, personId: string): Promise<string[]> {
  const { rows } = await db.query<{ entry: string }>(
    "SELECT entry FROM identity.did_log WHERE person_id = $1 ORDER BY version_number",
    [personId],
  );
  return rows.map((r) => r.entry);
}

/** Appends one entry. Callers hold the person's row lock (getPerson(..., true)). */
export async function appendDidLog(db: Db, personId: string, versionNumber: number, entry: object, now: Date): Promise<void> {
  await db.query(
    "INSERT INTO identity.did_log (person_id, version_number, entry, created_at) VALUES ($1, $2, $3, $4)",
    [personId, versionNumber, JSON.stringify(entry), now],
  );
}

// ---------------------------------------------------------------------------------------------
// recovery_tokens (inside forIdentity({ personId }))

export interface StoredToken {
  id: string;
  person_id: string;
  purpose: TokenPurpose;
  email: string | null;
  auth_request_id: string | null;
  expires_at: Date;
  used_at: Date | null;
}

/** Creates a token and returns it; only its SHA-256 is stored. */
export async function createToken(
  db: Db,
  t: { personId: string; purpose: TokenPurpose; email?: string; authRequestId?: string; now: Date },
): Promise<string> {
  const token = randomToken();
  await db.query(
    `INSERT INTO identity.recovery_tokens (person_id, token_hash, purpose, email, auth_request_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      t.personId,
      hashToken(token),
      t.purpose,
      t.email ?? null,
      t.authRequestId ?? null,
      t.now,
      new Date(t.now.getTime() + TOKEN_TTL_MS[t.purpose]),
    ],
  );
  return token;
}

/** The token row if it is this purpose, unused and unexpired at `now`. */
export async function liveToken(db: Db, token: string, purpose: TokenPurpose, now: Date): Promise<StoredToken | undefined> {
  const { rows } = await db.query<StoredToken>(
    `SELECT id, person_id, purpose, email, auth_request_id, expires_at, used_at
       FROM identity.recovery_tokens
      WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > $3`,
    [hashToken(token), purpose, now],
  );
  return rows[0];
}

/** Marks a token used; false if it was used or expired meanwhile (single use). */
export async function consumeToken(db: Db, id: string, now: Date): Promise<boolean> {
  const { rowCount } = await db.query(
    "UPDATE identity.recovery_tokens SET used_at = $2 WHERE id = $1 AND used_at IS NULL AND expires_at > $2",
    [id, now],
  );
  return rowCount === 1;
}

export async function tokensSince(db: Db, personId: string, purpose: TokenPurpose, since: Date): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM identity.recovery_tokens WHERE person_id = $1 AND purpose = $2 AND created_at > $3",
    [personId, purpose, since],
  );
  return rows[0]?.n ?? 0;
}

/** A token from a URL or form: base64url of 32 bytes, or nothing. */
export function tokenParam(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uuidParam(value: unknown): string | undefined {
  return typeof value === "string" && UUID.test(value) ? value : undefined;
}
