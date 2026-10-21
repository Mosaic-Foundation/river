// Each person's custodial Ed25519 key (spec 4.6, 3.2; ADR-002). The private key exists in clear
// only inside one call here: generated, sealed and stored, or opened, used once and dropped.
// Every signature is written to audit_log as key_used with its purpose. No function returns
// private key material to a caller outside this folder (check 28).
import type { KeyObject } from "node:crypto";
import { env } from "../../config/env.js";
import type { Db } from "../../db/context.js";
import { audit } from "../audit.js";
import {
  generateEd25519,
  privateKeyFromPkcs8,
  privateKeyToPkcs8,
  publicJwk,
  signEd25519,
  toMultikey,
  type PublicJwk,
} from "./ed25519.js";
import { openPrivateKey, parseMasterKey, sealPrivateKey } from "./envelope.js";

export { fromMultikey, publicFromRaw, toMultikey, verifyEd25519 } from "./ed25519.js";

/** What a signature is for, as recorded in audit_log. */
export type KeyPurpose = "did_log" | "signin_note";

let master: Buffer | undefined;

function masterKey(): Buffer {
  master ??= parseMasterKey(env.identityMasterKey);
  return master;
}

/** The fragment of every person's authentication key (spec 4.6). */
export const KEY_FRAGMENT = "key-1";

export function kidFor(did: string): string {
  return `${did}#${KEY_FRAGMENT}`;
}

/**
 * A key that is about to belong to a person, before the person's row exists (the DID, which the
 * row needs, is signed with this key). `sign` signs and remembers the use; `store` seals the key
 * under the master key, writes the keys row and then audits every use `sign` remembered.
 */
export interface PendingKey {
  multikey: string;
  jwk: PublicJwk;
  sign(purpose: KeyPurpose, data: Uint8Array): Promise<Buffer>;
  store(db: Db, personId: string, did: string, at: Date): Promise<void>;
}

export function newPersonKey(): PendingKey {
  const pair = generateEd25519();
  const multikey = toMultikey(pair.publicKey);
  const jwk = publicJwk(pair.publicKey);
  const uses: KeyPurpose[] = [];
  return {
    multikey,
    jwk,
    async sign(purpose, data) {
      uses.push(purpose);
      return signEd25519(pair.privateKey, data);
    },
    async store(db, personId, did, at) {
      const pkcs8 = privateKeyToPkcs8(pair.privateKey);
      try {
        await insertKeyRow(db, personId, did, jwk, sealPrivateKey(masterKey(), did, pkcs8), at);
      } finally {
        pkcs8.fill(0);
      }
      for (const purpose of uses.splice(0)) {
        await audit(db, personId, "key_used", { purpose, key: kidFor(did) }, at);
      }
    },
  };
}

async function insertKeyRow(
  db: Db,
  personId: string,
  did: string,
  jwk: PublicJwk,
  sealed: { privateKeyCiphertext: Buffer; wrappedDek: Buffer },
  at: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO identity.keys (person_id, kid, public_jwk, private_key_ciphertext, wrapped_dek, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [personId, kidFor(did), JSON.stringify(jwk), sealed.privateKeyCiphertext, sealed.wrappedDek, at],
  );
}

/**
 * recover-dids: retires the person's active key and stores a fresh one under the master key, as
 * the new #key-1. Returns the new key's multikey. The new private key is never used here.
 */
export async function replacePersonKey(db: Db, personId: string, did: string, at: Date): Promise<string> {
  await db.query(
    "UPDATE identity.keys SET retired_at = $2 WHERE person_id = $1 AND retired_at IS NULL",
    [personId, at],
  );
  const pair = generateEd25519();
  const pkcs8 = privateKeyToPkcs8(pair.privateKey);
  try {
    await insertKeyRow(db, personId, did, publicJwk(pair.publicKey), sealPrivateKey(masterKey(), did, pkcs8), at);
  } finally {
    pkcs8.fill(0);
  }
  return toMultikey(pair.publicKey);
}

interface KeyRow {
  kid: string;
  public_jwk: PublicJwk;
  private_key_ciphertext: Buffer;
  wrapped_dek: Buffer;
}

/**
 * Signs `data` with the person's active key and audits the use. Runs inside forIdentity() for
 * that person: row-level security limits the key lookup to their own row.
 */
export async function signAsPerson(
  db: Db,
  person: { id: string; did: string },
  purpose: KeyPurpose,
  data: Uint8Array,
  at: Date,
): Promise<Buffer> {
  const { rows } = await db.query<KeyRow>(
    `SELECT kid, public_jwk, private_key_ciphertext, wrapped_dek
       FROM identity.keys WHERE person_id = $1 AND retired_at IS NULL`,
    [person.id],
  );
  const row = rows[0];
  if (!row) throw new Error("This person has no active key");
  const pkcs8 = openPrivateKey(masterKey(), person.did, {
    privateKeyCiphertext: row.private_key_ciphertext,
    wrappedDek: row.wrapped_dek,
  });
  let privateKey: KeyObject;
  try {
    privateKey = privateKeyFromPkcs8(pkcs8);
  } finally {
    pkcs8.fill(0);
  }
  return signAndAudit(db, person.id, privateKey, purpose, row.kid, data, at);
}

async function signAndAudit(
  db: Db,
  personId: string,
  privateKey: KeyObject,
  purpose: KeyPurpose,
  keyRef: string,
  data: Uint8Array,
  at: Date,
): Promise<Buffer> {
  const signature = signEd25519(privateKey, data);
  await audit(db, personId, "key_used", { purpose, key: keyRef }, at);
  return signature;
}
