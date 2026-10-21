// Envelope encryption for each person's private key (spec 3.2, Appendix B; ADR-002).
//
// A fresh 32-byte data key (DEK) encrypts the person's PKCS#8 private key with AES-256-GCM; the
// master key (IDENTITY_MASTER_KEY, held only in the identity host's secrets) wraps the DEK with
// AES-256-GCM. Both use the person's DID as additional authenticated data, so a ciphertext copied
// onto another person's row fails to open. Stored layout for both: iv (12) || tag (16) || data.
//
// Never log a key, a DEK or a plaintext; errors here say what failed, never with what.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface SealedPrivateKey {
  /** iv || tag || AES-256-GCM(DEK, pkcs8, aad = DID) */
  privateKeyCiphertext: Buffer;
  /** iv || tag || AES-256-GCM(master, DEK, aad = DID); always 60 bytes */
  wrappedDek: Buffer;
}

/** Reads IDENTITY_MASTER_KEY's value: base64 of exactly 32 bytes. The message never echoes it. */
export function parseMasterKey(base64: string): Buffer {
  const trimmed = base64.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new Error("IDENTITY_MASTER_KEY must be base64 (32 random bytes)");
  }
  const key = Buffer.from(trimmed, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("IDENTITY_MASTER_KEY must decode to exactly 32 bytes");
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
    throw new Error(`${what} failed to decrypt (wrong key, wrong DID or tampered data)`);
  }
}

function aadFor(did: string): Buffer {
  if (!did.startsWith("did:")) throw new Error("The additional authenticated data must be a DID");
  return Buffer.from(did, "utf8");
}

export function sealPrivateKey(masterKey: Buffer, did: string, pkcs8: Buffer): SealedPrivateKey {
  const aad = aadFor(did);
  const dek = randomBytes(KEY_BYTES);
  try {
    return {
      privateKeyCiphertext: seal(dek, pkcs8, aad),
      wrappedDek: seal(masterKey, dek, aad),
    };
  } finally {
    dek.fill(0);
  }
}

/** Returns the PKCS#8 bytes. The caller zeroes them once the KeyObject is made. */
export function openPrivateKey(masterKey: Buffer, did: string, sealed: SealedPrivateKey): Buffer {
  const aad = aadFor(did);
  const dek = open(masterKey, sealed.wrappedDek, aad, "The wrapped data key");
  try {
    return open(dek, sealed.privateKeyCiphertext, aad, "The private key");
  } finally {
    dek.fill(0);
  }
}
