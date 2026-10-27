// Envelope encryption for the credentials the River holds for members (ADR-010 §5).
//
// The River's own copy of Mosaic ID's scheme (src/identity/keys/envelope.ts), kept apart because
// Mosaic ID is moving to its own repository and the two share no code (DECISIONS.md, 2026-10-27).
// The scheme is the same; this copy takes any additional authenticated data, not only a DID.
//
// A fresh 32-byte data key (DEK) encrypts the value with AES-256-GCM; the master key
// (RIVER_TOKEN_KEY, held only in the River's secrets) wraps the DEK with AES-256-GCM. Both use the
// same additional data, which names the row the value belongs to, so a ciphertext copied onto
// another row fails to open. Stored layout for both: iv (12) || tag (16) || data.
//
// Never log a key, a DEK or a plaintext; errors here say what failed, never with what.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface Sealed {
  /** iv || tag || AES-256-GCM(DEK, plaintext, aad) */
  ciphertext: Buffer;
  /** iv || tag || AES-256-GCM(master, DEK, aad); always 60 bytes */
  wrappedDek: Buffer;
}

/** Reads a master key's value: base64 of exactly 32 bytes. The message names the variable, never the value. */
export function parseMasterKey(name: string, base64: string): Buffer {
  const trimmed = base64.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new Error(`${name} must be base64 (32 random bytes)`);
  }
  const key = Buffer.from(trimmed, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`${name} must decode to exactly 32 bytes`);
  }
  return key;
}

function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

function open(key: Buffer, sealed: Buffer, aad: Buffer, what: string): Buffer {
  if (sealed.length <= IV_BYTES + TAG_BYTES) throw new Error(`${what} is too short`);
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
  } catch {
    throw new Error(`${what} failed to decrypt (wrong key, wrong row or tampered data)`);
  }
}

function aadBytes(aad: string): Buffer {
  if (aad === "") throw new Error("The additional authenticated data must not be empty");
  return Buffer.from(aad, "utf8");
}

export function sealValue(masterKey: Buffer, aad: string, plaintext: Buffer): Sealed {
  const ad = aadBytes(aad);
  const dek = randomBytes(KEY_BYTES);
  try {
    return { ciphertext: seal(dek, plaintext, ad), wrappedDek: seal(masterKey, dek, ad) };
  } finally {
    dek.fill(0);
  }
}

/** Returns the plaintext bytes; the caller zeroes them once used. */
export function openValue(masterKey: Buffer, aad: string, sealed: Sealed): Buffer {
  const ad = aadBytes(aad);
  const dek = open(masterKey, sealed.wrappedDek, ad, "The wrapped data key");
  try {
    return open(dek, sealed.ciphertext, ad, "The value");
  } finally {
    dek.fill(0);
  }
}
