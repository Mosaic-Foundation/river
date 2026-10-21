// Envelope encryption of each person's key (spec 3.2, Appendix B; check 28's unit half) and the
// Ed25519 helpers.
import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  fromMultikey,
  generateEd25519,
  privateKeyFromPkcs8,
  privateKeyToPkcs8,
  publicJwk,
  signEd25519,
  toMultikey,
  verifyEd25519,
} from "../../src/identity/keys/ed25519.js";
import { openPrivateKey, parseMasterKey, sealPrivateKey } from "../../src/identity/keys/envelope.js";

const DID = "did:webvh:QmScid:id.mosaic.social:u:abcdefgh";
const OTHER_DID = "did:webvh:QmScid:id.mosaic.social:u:zzzzzzzz";

function sealed() {
  const master = randomBytes(32);
  const pair = generateEd25519();
  const pkcs8 = privateKeyToPkcs8(pair.privateKey);
  return { master, pair, pkcs8: Buffer.from(pkcs8), box: sealPrivateKey(master, DID, pkcs8) };
}

describe("envelope encryption", () => {
  it("round-trips a private key under the master key with the DID as AAD", () => {
    const { master, pair, pkcs8, box } = sealed();
    const opened = openPrivateKey(master, DID, box);
    expect(opened.equals(pkcs8)).toBe(true);
    const key = privateKeyFromPkcs8(opened);
    const sig = signEd25519(key, Buffer.from("hello"));
    expect(verifyEd25519(pair.publicKey, Buffer.from("hello"), sig)).toBe(true);
  });

  it("stores iv || tag || ciphertext; the wrapped data key is 60 bytes", () => {
    const { box, pkcs8 } = sealed();
    expect(box.wrappedDek).toHaveLength(12 + 16 + 32);
    expect(box.privateKeyCiphertext).toHaveLength(12 + 16 + pkcs8.length);
  });

  it("fails with another master key, another DID, or any flipped byte", () => {
    const { master, box } = sealed();
    expect(() => openPrivateKey(randomBytes(32), DID, box)).toThrow(/wrapped data key failed/);
    expect(() => openPrivateKey(master, OTHER_DID, box)).toThrow(/failed to decrypt/);
    for (const field of ["privateKeyCiphertext", "wrappedDek"] as const) {
      for (const index of [0, 13, box[field].length - 1]) {
        const tampered = { ...box, [field]: Buffer.from(box[field]) };
        tampered[field][index] ^= 1;
        expect(() => openPrivateKey(master, DID, tampered), `${field}[${index}]`).toThrow(/failed to decrypt/);
      }
    }
  });

  it("check 28: the ciphertext is no parseable private key and holds no PKCS#8 header", () => {
    const { box, pkcs8, pair } = sealed();
    const header = pkcs8.subarray(0, 16);
    const x = publicJwk(pair.publicKey).x;
    // The public key a 32-byte window would give if it were the seed. Derived rather than checked
    // through a JWK import, which only some Node versions refuse when d doesn't match x.
    const publicXOf = (seed: Buffer) =>
      createPublicKey(createPrivateKey({ key: Buffer.concat([header, seed]), format: "der", type: "pkcs8" })).export({ format: "jwk" }).x;
    // The control: the real seed (the last 32 bytes of Ed25519 PKCS#8) gives x.
    expect(publicXOf(pkcs8.subarray(-32))).toBe(x);
    for (const blob of [box.privateKeyCiphertext, box.wrappedDek]) {
      expect(blob.includes(header)).toBe(false);
      expect(blob.includes(pkcs8.subarray(16))).toBe(false);
      for (const type of ["pkcs8", "sec1", "pkcs1"] as const) {
        expect(() => createPrivateKey({ key: blob, format: "der", type })).toThrow();
      }
      expect(() => createPrivateKey(blob.toString("utf8"))).toThrow();
      // No 32-byte window is the seed.
      for (let i = 0; i + 32 <= blob.length; i++) {
        expect(publicXOf(blob.subarray(i, i + 32))).not.toBe(x);
      }
    }
  });

  it("reads IDENTITY_MASTER_KEY as base64 of exactly 32 bytes, never echoing it", () => {
    const value = randomBytes(32).toString("base64");
    expect(parseMasterKey(value)).toHaveLength(32);
    for (const bad of [randomBytes(16).toString("base64"), "not base64!", randomBytes(33).toString("base64")]) {
      let message = "";
      try {
        parseMasterKey(bad);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/IDENTITY_MASTER_KEY/);
      expect(message).not.toContain(bad);
    }
  });

  it("refuses AAD that isn't a DID", () => {
    expect(() => sealPrivateKey(randomBytes(32), "person-1", Buffer.from("x"))).toThrow(/DID/);
  });
});

describe("Ed25519 multikeys", () => {
  it("encodes z6Mk… and decodes back to the same key", () => {
    const pair = generateEd25519();
    const multikey = toMultikey(pair.publicKey);
    expect(multikey).toMatch(/^z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/);
    expect(publicJwk(fromMultikey(multikey))).toEqual(publicJwk(pair.publicKey));
  });

  it("refuses other multikeys and junk", () => {
    expect(() => fromMultikey("z6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc")).toThrow(/Ed25519/); // X25519
    expect(() => fromMultikey("u7QE")).toThrow();
    expect(() => fromMultikey("")).toThrow();
  });
});
