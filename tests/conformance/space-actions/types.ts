// The shape of vectors.json (space-actions-1 section 8).
import type { RefusalCode } from "../../../src/shared/spaceActions/index.js";

export interface VectorDid {
  did: string;
  kid: string;
  /** Where the log is served (https://{host}/u/{code}/did.jsonl). */
  log_url: string;
  /** The did.jsonl text. */
  log: string;
  /** The Ed25519 private key's 32-byte seed, hex. TEST ONLY. */
  key_seed: string;
  note: string;
}

export interface VectorRequest {
  content_type: string;
  body: string;
  expect: {
    status: number;
    code?: RefusalCode;
    /** The verifier must refuse without reading any DID log (steps 1 to 4). */
    no_did_request?: boolean;
    /** The answer must equal the answer to this earlier request of the same case. */
    same_as?: number;
  };
}

export interface VectorCase {
  name: string;
  /** The step of section 4 the case is about (0 for a valid request). */
  step: number;
  description: string;
  /** Sent in order to the same space; each with its expected answer. */
  requests: VectorRequest[];
}

export interface HostVector {
  list: string[];
  host: string;
  matches: boolean;
  note: string;
}

export interface Vectors {
  protocol: string;
  note: string;
  /** The fixed clock, in seconds since the epoch. */
  now: number;
  manifest_url: string;
  manifest: { space: { id: string; type: string }; actions: Record<string, unknown> };
  dids: VectorDid[];
  /** Host-list matching (src/shared/hosts/): every list in the protocol reads entries this way. */
  hosts: HostVector[];
  cases: VectorCase[];
}
