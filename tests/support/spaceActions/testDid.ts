// Test DIDs for Mosaic Space Actions (tests only; never trusted anywhere real). A DID is made the
// way Mosaic ID makes one (src/identity/did/: createPersonDid, one key under authentication), and
// then gets `assertionMethod: [#key-1]` in a second log entry, as Mosaic ID's first grant adds it
// (space-actions-1 5.1 step 5). Keys come from 32-byte seeds, and timestamps are fixed, so the
// same inputs always give the same log: the vectors in tests/conformance/space-actions/ rely on it.
import { createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import { deactivateDID, updateDID } from "didwebvh-ts";
import { createPersonDid, toJsonl, updateKeySigner, verifier } from "../../../src/identity/did/index.js";
import { toMultikey } from "../../../src/identity/keys/ed25519.js";
import { DidResolutionError, DidResolver } from "../../../src/river/auth/did.js";
import { DidUnavailableError, type DidDocumentResolver } from "../../../src/shared/spaceActions/index.js";

export interface SeededKey {
  privateKey: KeyObject;
  publicKey: KeyObject;
  multikey: string;
  sign: (data: Uint8Array) => Promise<Buffer>;
}

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

/** An Ed25519 key from a 32-byte seed (hex). */
export function seededKey(seedHex: string): SeededKey {
  const seed = Buffer.from(seedHex, "hex");
  if (seed.length !== 32) throw new Error("A seed is 32 bytes");
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, multikey: toMultikey(publicKey), sign: async (data) => sign(null, data, privateKey) };
}

export interface TestActionDid {
  did: string;
  kid: string;
  /** The log as served at its did.jsonl URL. */
  jsonl: string;
  /** Where the log is served: https://{host}/{path}/did.jsonl. */
  logUrl: string;
  key: SeededKey;
}

/**
 * A did:webvh at `host` (`id.test.example`, or `localhost:3001`), path `u/{code}`. With
 * `assertion: false` the document lists the key under authentication only, as before a grant.
 */
export async function makeActionDid(options: {
  host: string;
  code: string;
  keySeed: string;
  recoverySeed: string;
  created: Date;
  assertion?: boolean;
  /** Ends the log with a deactivation. */
  deactivated?: boolean;
}): Promise<TestActionDid> {
  const key = seededKey(options.keySeed);
  const recovery = seededKey(options.recoverySeed);
  const created = await createPersonDid({
    origin: `https://${options.host}`,
    code: options.code,
    personMultikey: key.multikey,
    recoveryMultikey: recovery.multikey,
    sign: key.sign,
    created: options.created,
  });
  let log = created.log;
  if (options.assertion ?? true) {
    const did = created.did;
    const updated = await updateDID({
      log,
      signer: updateKeySigner(key.multikey, key.sign),
      verifier,
      updateKeys: [key.multikey, recovery.multikey],
      verificationMethods: [{ id: `${did}#key-1`, type: "Multikey", controller: did, publicKeyMultibase: key.multikey }],
      authentication: [`${did}#key-1`],
      assertionMethod: [`${did}#key-1`],
      witnessProofs: [],
      updated: `${new Date(options.created.getTime() + 1000).toISOString().slice(0, 19)}Z`,
    });
    log = updated.log;
  }
  if (options.deactivated) {
    const ended = await deactivateDID({ log, signer: updateKeySigner(key.multikey, key.sign), verifier });
    log = ended.log;
  }
  return {
    did: created.did,
    kid: `${created.did}#key-1`,
    jsonl: toJsonl(log),
    logUrl: `https://${options.host}/u/${options.code}/did.jsonl`,
    key,
  };
}

/**
 * The River's own DID resolver (src/river/auth/did.ts: the guard, the 10-minute cache, the
 * library's log verification), reading logs from a map instead of the network. Counts requests.
 */
export class MapDidResolver implements DidDocumentResolver {
  readonly logs = new Map<string, string>();
  requests: string[] = [];
  /** When set, every request throws this instead of answering (a network failure). */
  failWith: Error | undefined;
  /** When set, every request answers this status. */
  status: number | undefined;
  private readonly inner: DidResolver;

  constructor(now: () => number = Date.now) {
    this.inner = new DidResolver({
      now,
      guard: {
        fetch: async (url: string) => {
          this.requests.push(url);
          if (this.failWith) throw this.failWith;
          if (this.status !== undefined) return new Response("", { status: this.status });
          const body = this.logs.get(url);
          return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 });
        },
      },
    });
  }

  serve(did: TestActionDid): this {
    this.logs.set(did.logUrl, did.jsonl);
    return this;
  }

  /** What a space's resolver must do: a log that couldn't be read just now is did_unavailable. */
  async resolve(...args: Parameters<DidDocumentResolver["resolve"]>): ReturnType<DidDocumentResolver["resolve"]> {
    try {
      return await this.inner.resolve(args[0], args[1]);
    } catch (err) {
      if (err instanceof DidUnavailableError) throw err;
      if (err instanceof DidResolutionError && !/answered (?:429|5\d\d)$/.test(err.message)) throw err;
      throw new DidUnavailableError();
    }
  }
}
