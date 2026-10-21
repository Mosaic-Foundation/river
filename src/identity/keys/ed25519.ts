// Ed25519 keys with node:crypto, and their public forms: raw bytes, JWK, and the multikey string
// (`z` + base58btc of 0xed01 || key) that did:webvh update keys and verification methods use.
// Nothing here logs or returns private key material except as a KeyObject or PKCS#8 bytes for
// the envelope in ./envelope.ts.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { MultibaseEncoding, multibaseDecode, multibaseEncode } from "didwebvh-ts";

/** The multicodec prefix for an Ed25519 public key (0xed, varint-encoded as 0xed 0x01). */
const ED25519_PUB = Uint8Array.of(0xed, 0x01);

export interface Ed25519KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export interface PublicJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
}

export function generateEd25519(): Ed25519KeyPair {
  return generateKeyPairSync("ed25519");
}

export function publicKeyRaw(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    throw new Error("Not an Ed25519 public key");
  }
  return Buffer.from(jwk.x, "base64url");
}

export function publicJwk(publicKey: KeyObject): PublicJwk {
  return { kty: "OKP", crv: "Ed25519", x: publicKeyRaw(publicKey).toString("base64url") };
}

export function toMultikey(publicKey: KeyObject): string {
  const raw = publicKeyRaw(publicKey);
  const bytes = new Uint8Array(ED25519_PUB.length + raw.length);
  bytes.set(ED25519_PUB, 0);
  bytes.set(raw, ED25519_PUB.length);
  return multibaseEncode(bytes, MultibaseEncoding.BASE58_BTC);
}

/** Parses an Ed25519 multikey (`z6Mk…`) into a public KeyObject; throws on anything else. */
export function fromMultikey(multikey: string): KeyObject {
  if (typeof multikey !== "string" || !/^z[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(multikey)) {
    throw new Error("Not a base58btc multikey");
  }
  const { bytes } = multibaseDecode(multikey);
  if (bytes.length !== 34 || bytes[0] !== ED25519_PUB[0] || bytes[1] !== ED25519_PUB[1]) {
    throw new Error("Not an Ed25519 multikey");
  }
  return publicFromRaw(bytes.slice(2));
}

export function publicFromRaw(raw: Uint8Array): KeyObject {
  if (raw.length !== 32) throw new Error("An Ed25519 public key is 32 bytes");
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") },
    format: "jwk",
  });
}

export function privateKeyToPkcs8(privateKey: KeyObject): Buffer {
  return privateKey.export({ format: "der", type: "pkcs8" });
}

export function privateKeyFromPkcs8(pkcs8: Buffer): KeyObject {
  const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Not an Ed25519 private key");
  return key;
}

export function signEd25519(privateKey: KeyObject, data: Uint8Array): Buffer {
  return sign(null, data, privateKey);
}

export function verifyEd25519(publicKey: KeyObject, data: Uint8Array, signature: Uint8Array): boolean {
  try {
    return verify(null, data, publicKey, signature);
  } catch {
    return false;
  }
}
