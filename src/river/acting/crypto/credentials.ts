// The credentials the River holds to act for members, sealed under RIVER_TOKEN_KEY (ADR-010 §5).
//
// Two kinds, each bound to its row by the additional data:
//   a member's credential   river-token:v1|{instance_id}|{account_id}|{row id}|{purpose}
//                           (a linked account's token, a Mosaic ID grant token, a PKCE verifier)
//   a server's client secret river-client:v1|{instance_id}|{server host}
//                           (from per-server app registration; the instance's, not an account's)
//
// Every sealed value records the master key's version (key_version columns), so the key can be
// rotated by re-wrapping data keys. Version 1 is RIVER_TOKEN_KEY; a rotation adds the next one
// beside it (DECISIONS.md, 2026-10-27, "RIVER_TOKEN_KEY").
//
// Nothing here logs, returns or puts in an error a credential, a key or a data key.
import { env } from "../../../config/env.js";
import { openValue, parseMasterKey, sealValue, type Sealed } from "./envelope.js";

export const CURRENT_KEY_VERSION = 1;

export const CREDENTIAL_PURPOSES = ["fediverse_token", "grant_token", "pkce_verifier"] as const;
export type CredentialPurpose = (typeof CREDENTIAL_PURPOSES)[number];

/** The row a member's credential belongs to. */
export interface CredentialRow {
  instanceId: string;
  accountId: string;
  rowId: string;
  purpose: CredentialPurpose;
}

/** The server a client secret belongs to, for one instance. */
export interface ClientRow {
  instanceId: string;
  host: string;
}

/** A sealed value as stored: the two ciphertexts and the master key's version. */
export interface StoredSecret extends Sealed {
  keyVersion: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$/;

function uuid(name: string, value: string): string {
  if (!UUID.test(value)) throw new Error(`${name} must be a lowercase UUID`);
  return value;
}

/** The additional data for a member's credential. Exported for tests. */
export function credentialAad(row: CredentialRow): string {
  if (!(CREDENTIAL_PURPOSES as readonly string[]).includes(row.purpose)) {
    throw new Error("Unknown credential purpose");
  }
  return [
    "river-token:v1",
    uuid("instanceId", row.instanceId),
    uuid("accountId", row.accountId),
    uuid("rowId", row.rowId),
    row.purpose,
  ].join("|");
}

/** The additional data for a server's client secret. Exported for tests. */
export function clientAad(row: ClientRow): string {
  if (!HOST.test(row.host) || row.host.length > 260) throw new Error("host must be a lowercase hostname");
  return ["river-client:v1", uuid("instanceId", row.instanceId), row.host].join("|");
}

let cached: { raw: string; key: Buffer } | undefined;

/** The master key for a stored version. Only version 1 exists until a rotation adds the next. */
function masterKey(version: number): Buffer {
  if (version !== CURRENT_KEY_VERSION) {
    throw new Error(`No RIVER_TOKEN_KEY for key version ${version}`);
  }
  const raw = env.riverTokenKey;
  if (cached?.raw !== raw) cached = { raw, key: parseMasterKey("RIVER_TOKEN_KEY", raw) };
  return cached.key;
}

function sealString(aad: string, secret: string): StoredSecret {
  if (secret === "") throw new Error("Refusing to seal an empty value");
  const plaintext = Buffer.from(secret, "utf8");
  try {
    return { ...sealValue(masterKey(CURRENT_KEY_VERSION), aad, plaintext), keyVersion: CURRENT_KEY_VERSION };
  } finally {
    plaintext.fill(0);
  }
}

function openString(aad: string, stored: StoredSecret): string {
  const plaintext = openValue(masterKey(stored.keyVersion), aad, stored);
  try {
    return plaintext.toString("utf8");
  } finally {
    plaintext.fill(0);
  }
}

export function sealCredential(row: CredentialRow, secret: string): StoredSecret {
  return sealString(credentialAad(row), secret);
}

export function openCredential(row: CredentialRow, stored: StoredSecret): string {
  return openString(credentialAad(row), stored);
}

export function sealClientSecret(row: ClientRow, secret: string): StoredSecret {
  return sealString(clientAad(row), secret);
}

export function openClientSecret(row: ClientRow, stored: StoredSecret): string {
  return openString(clientAad(row), stored);
}
