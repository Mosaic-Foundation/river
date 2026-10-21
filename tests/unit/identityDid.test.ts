// did:webvh logs through didwebvh-ts (spec 4.6; checks 9 and 37, unit halves). Each log is also
// checked with the library's own resolveDIDFromLog, not only through src/identity/did/.
import { describe, expect, it } from "vitest";
import { resolveDIDFromLog, type DIDLog } from "didwebvh-ts";
import {
  appendKeyRotation,
  createPersonDid,
  didAddress,
  parseJsonl,
  toJsonl,
  verifier,
  verifyLog,
} from "../../src/identity/did/index.js";
import { generateEd25519, signEd25519, toMultikey, type Ed25519KeyPair } from "../../src/identity/keys/ed25519.js";

function key(): Ed25519KeyPair & { multikey: string; sign: (d: Uint8Array) => Promise<Buffer> } {
  const pair = generateEd25519();
  return { ...pair, multikey: toMultikey(pair.publicKey), sign: async (d) => signEd25519(pair.privateKey, d) };
}

const EARLIER = new Date(Date.now() - 60_000);

async function newDid(origin = "https://id.mosaic.social") {
  const person = key();
  const recovery = key();
  const created = await createPersonDid({
    origin,
    code: "abcdefgh",
    personMultikey: person.multikey,
    recoveryMultikey: recovery.multikey,
    sign: person.sign,
    created: EARLIER,
  });
  return { person, recovery, created };
}

describe("a person's DID", () => {
  it("has the spec's shape and a first entry with did:webvh:1.0, portable and two update keys", async () => {
    const { person, recovery, created } = await newDid();
    expect(created.did).toBe(`did:webvh:${created.scid}:id.mosaic.social:u:abcdefgh`);
    expect(created.log).toHaveLength(1);
    const [entry] = created.log;
    expect(entry.parameters.method).toBe("did:webvh:1.0");
    expect(entry.parameters.portable).toBe(true);
    expect(entry.parameters.updateKeys).toEqual([person.multikey, recovery.multikey]);
    expect(entry.state.authentication).toEqual([`${created.did}#key-1`]);
    expect(entry.state.verificationMethod).toEqual([
      { id: `${created.did}#key-1`, type: "Multikey", controller: created.did, publicKeyMultibase: person.multikey },
    ]);
    expect(entry.proof?.[0].verificationMethod).toBe(`did:key:${person.multikey}#${person.multikey}`);
  });

  it("verifies with the library's own log verification", async () => {
    const { created } = await newDid();
    const result = await resolveDIDFromLog(created.log, { verifier, witnessProofs: [] });
    expect(result.meta.error).toBeUndefined();
    expect(result.did).toBe(created.did);
    expect(result.meta.scid).toBe(created.scid);
    expect(result.meta.portable).toBe(true);
  });

  it("encodes a local port the way the library resolves it", async () => {
    expect(didAddress("http://localhost:3001")).toBe("localhost:3001");
    const { created } = await newDid("http://localhost:3001");
    expect(created.did).toMatch(/^did:webvh:Qm\w+:localhost%3A3001:u:abcdefgh$/);
    expect((await verifyLog(created.log)).did).toBe(created.did);
  });

  it("refuses the same key as person and recovery key", async () => {
    const one = key();
    await expect(
      createPersonDid({ origin: "https://id.mosaic.social", code: "abcdefgh", personMultikey: one.multikey, recoveryMultikey: one.multikey, sign: one.sign, created: EARLIER }),
    ).rejects.toThrow(/differ/);
  });

  it("round-trips through did.jsonl and fails verification when tampered", async () => {
    const { created } = await newDid();
    const text = toJsonl(created.log);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.split("\n")).toHaveLength(2);
    expect(parseJsonl(text)).toEqual(created.log);
    const tampered = JSON.parse(JSON.stringify(created.log)) as DIDLog;
    tampered[0].state.verificationMethod![0].publicKeyMultibase = key().multikey;
    await expect(verifyLog(tampered)).rejects.toThrow();
  });
});

describe("recovery rotation (check 37)", () => {
  it("the recovery key appends an entry that makes a new key #key-1; the SCID stays", async () => {
    const { recovery, created } = await newDid();
    const fresh = key();
    const { log, entry } = await appendKeyRotation({
      log: created.log,
      signerMultikey: recovery.multikey,
      sign: recovery.sign,
      newMultikey: fresh.multikey,
      recoveryMultikey: recovery.multikey,
      updated: new Date(),
    });
    expect(log).toHaveLength(2);
    expect(entry.versionId).toMatch(/^2-/);
    expect(entry.proof?.[0].verificationMethod).toBe(`did:key:${recovery.multikey}#${recovery.multikey}`);
    expect(entry.parameters.updateKeys).toEqual([fresh.multikey, recovery.multikey]);
    const result = await resolveDIDFromLog(log, { verifier, witnessProofs: [] });
    expect(result.meta.error).toBeUndefined();
    expect(result.meta.scid).toBe(created.scid);
    expect(result.did).toBe(created.did);
    const vm = result.doc.verificationMethod?.find((v) => v.id === `${created.did}#key-1`);
    expect(vm?.publicKeyMultibase).toBe(fresh.multikey);
    expect(result.doc.authentication).toEqual([`${created.did}#key-1`]);
  });

  it("a key that isn't an update key can't append", async () => {
    const { created } = await newDid();
    const stranger = key();
    await expect(
      appendKeyRotation({
        log: created.log,
        signerMultikey: stranger.multikey,
        sign: stranger.sign,
        newMultikey: key().multikey,
        recoveryMultikey: stranger.multikey,
        updated: new Date(),
      }),
    ).rejects.toThrow(/not one of this DID's update keys/);
  });

  it("an entry signed by the wrong key fails the library's verification", async () => {
    const { recovery, created } = await newDid();
    const stranger = key();
    await expect(
      appendKeyRotation({
        log: created.log,
        signerMultikey: recovery.multikey,
        sign: stranger.sign, // claims the recovery key, signs with another
        newMultikey: key().multikey,
        recoveryMultikey: recovery.multikey,
        updated: new Date(),
      }),
    ).rejects.toThrow();
  });
});
