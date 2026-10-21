// did:webvh v1.0 through didwebvh-ts (spec 4.6; DECISIONS "didwebvh-ts 2.8.0"). Never hand-rolled:
// the library builds, signs (through our signer) and verifies every log entry.
//
// Only createDID, updateDID and resolveDIDFromLog are used. They work on logs in memory; the
// library's resolveDID() would fetch over the network with global fetch, which constraint 3
// forbids, so nothing here calls it (and witness proofs are always passed in, as none).
//
// DID form: did:webvh:{SCID}:{host}:u:{code}, where {host} is IDENTITY_PUBLIC_ORIGIN's host
// (id.mosaic.social; localhost%3A3001 locally, the library's encoding of a port). The person's key
// is the first update key and the authentication method {did}#key-1; Mosaic's recovery key
// (IDENTITY_RECOVERY_PUBLIC_KEY) is the second update key (check 37).
import {
  MultibaseEncoding,
  createDID,
  multibaseDecode,
  multibaseEncode,
  prepareDataForSigning,
  resolveDIDFromLog,
  updateDID,
  type DIDDoc,
  type DIDLog,
  type DIDLogEntry,
  type DIDResolutionMeta,
  type Signer,
  type Verifier,
} from "didwebvh-ts";
import { publicFromRaw, verifyEd25519 } from "../keys/ed25519.js";

export type { DIDDoc, DIDLog, DIDLogEntry, DIDResolutionMeta };

export const METHOD = "did:webvh:1.0";

/** Verifies the library's eddsa-jcs-2022 proofs with node:crypto. */
export const verifier: Verifier = {
  async verify(signature, message, publicKey) {
    try {
      return verifyEd25519(publicFromRaw(publicKey), message, signature);
    } catch {
      return false;
    }
  },
};

/**
 * A did:webvh signer for one Ed25519 update key. `sign` gets the bytes to sign and returns the
 * signature; the caller decides whose key that is and audits the use.
 */
export function updateKeySigner(multikey: string, sign: (data: Uint8Array) => Promise<Uint8Array>): Signer {
  return {
    getVerificationMethodId: () => `did:key:${multikey}#${multikey}`,
    async sign({ document, proof }) {
      const data = await prepareDataForSigning(document, proof);
      const signature = await sign(data);
      return { proofValue: multibaseEncode(new Uint8Array(signature), MultibaseEncoding.BASE58_BTC) };
    },
  };
}

/** The DID host component for an origin: `id.mosaic.social`, or `localhost:3001` locally. */
export function didAddress(origin: string): string {
  const url = new URL(origin);
  if (url.origin !== origin.replace(/\/$/, "")) throw new Error(`Not an origin: ${origin}`);
  return url.host;
}

/**
 * The DID document every person's DID starts with: one key, used to authenticate. Written with the
 * library's `{SCID}` placeholder, which it replaces once the SCID is derived. (Its `{DID}`
 * placeholder produces logs its own resolver rejects in 2.8.0, so it isn't used.)
 */
function documentTemplate(origin: string, code: string, personMultikey: string): DIDDoc {
  // A port is part of the host component, encoded as %3A (did:webvh 1.0 §3.4).
  const did = `did:webvh:{SCID}:${didAddress(origin).replace(":", "%3A")}:u:${code}`;
  return {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
    id: did,
    controller: did,
    verificationMethod: [
      { id: `${did}#key-1`, type: "Multikey", controller: did, publicKeyMultibase: personMultikey },
    ],
    authentication: [`${did}#key-1`],
  };
}

export interface CreatedDid {
  did: string;
  scid: string;
  log: DIDLog;
  doc: DIDDoc;
}

/**
 * Creates a person's DID and its first log entry, signed with the person's key. The entry sets
 * `method: did:webvh:1.0`, `portable: true` and exactly two update keys: the person's and the
 * recovery key.
 */
export async function createPersonDid(options: {
  origin: string;
  code: string;
  personMultikey: string;
  recoveryMultikey: string;
  sign: (data: Uint8Array) => Promise<Uint8Array>;
  created: Date;
}): Promise<CreatedDid> {
  if (options.personMultikey === options.recoveryMultikey) {
    throw new Error("The person's key and the recovery key must differ");
  }
  const result = await createDID({
    address: didAddress(options.origin),
    paths: ["u", options.code],
    signer: updateKeySigner(options.personMultikey, options.sign),
    verifier,
    updateKeys: [options.personMultikey, options.recoveryMultikey],
    didDocument: documentTemplate(options.origin, options.code, options.personMultikey),
    portable: true,
    witness: null,
    watchers: null,
    created: isoSeconds(options.created),
  });
  return { did: result.did, scid: result.meta.scid, log: result.log, doc: result.doc };
}

export interface VerifiedLog {
  did: string;
  doc: DIDDoc;
  meta: DIDResolutionMeta;
}

/**
 * Verifies a whole log with the library (hash chain, SCID, every proof against the update keys
 * in force) and returns the current document. Throws when the library reports an error.
 */
export async function verifyLog(log: DIDLog): Promise<VerifiedLog> {
  const result = await resolveDIDFromLog(log, { verifier, witnessProofs: [] });
  if (result.meta.error) {
    throw new Error(`The DID log does not verify: ${result.meta.problemDetails?.detail ?? result.meta.error}`);
  }
  if (!result.doc) throw new Error("The DID log resolved to no document");
  return result;
}

/**
 * Appends an entry signed by `signerMultikey` (which must be a current update key) that makes
 * `newMultikey` the person's update key and authentication key #key-1, keeping the recovery key as
 * the second update key. Used by recover-dids (spec 4.6, check 37).
 */
export async function appendKeyRotation(options: {
  log: DIDLog;
  signerMultikey: string;
  sign: (data: Uint8Array) => Promise<Uint8Array>;
  newMultikey: string;
  recoveryMultikey: string;
  updated: Date;
}): Promise<{ log: DIDLog; entry: DIDLogEntry }> {
  const current = await verifyLog(options.log);
  if (!current.meta.updateKeys.includes(options.signerMultikey)) {
    throw new Error("The signing key is not one of this DID's update keys");
  }
  const did = current.did;
  const result = await updateDID({
    log: options.log,
    signer: updateKeySigner(options.signerMultikey, options.sign),
    verifier,
    updateKeys: [options.newMultikey, options.recoveryMultikey],
    verificationMethods: [
      { id: `${did}#key-1`, type: "Multikey", controller: did, publicKeyMultibase: options.newMultikey },
    ],
    authentication: [`${did}#key-1`],
    witnessProofs: [],
    updated: isoSeconds(options.updated),
  });
  const entry = result.log[result.log.length - 1];
  return { log: result.log, entry };
}

/** The log as served at /u/{code}/did.jsonl: one JSON object per line. */
export function toJsonl(log: DIDLog): string {
  return log.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

export function parseJsonl(text: string): DIDLog {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as DIDLogEntry);
}

/** The raw 32-byte Ed25519 key inside a multikey. */
export function multikeyBytes(multikey: string): Uint8Array {
  return multibaseDecode(multikey).bytes.slice(2);
}

/** did:webvh timestamps are UTC seconds (2026-10-21T02:05:22Z). */
function isoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
