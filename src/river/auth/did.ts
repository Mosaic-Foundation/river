// did:webvh resolution for the sign-in callback (spec 4.6 step 4; ADR-001, ADR-002).
//
// The River reads a DID's log itself, through the fetch guard (never didwebvh-ts's resolveDID(),
// which calls global fetch), verifies the whole log with didwebvh-ts's resolveDIDFromLog, and uses
// the CURRENT document, so a DID re-keyed by recover-dids keeps signing in. Logs are cached for
// 10 minutes per URL; a caller whose note doesn't verify against a cached document asks once more
// with `fresh: true` (a re-key inside the cache window must not lock the person out).
//
// Only DIDs whose host is in TRUSTED_DID_HOSTS are read at all (v1: id.mosaic.social). Locally
// the identity host is localhost:3001, which the guard refuses (https only, no loopback); with the
// test-only TEST_DID_LOOPBACK=1 a trusted loopback host is read over http through
// src/shared/fetch/loopback.ts instead (DECISIONS, M8). This file never imports src/identity/
// (CLAUDE.md constraint 7): the two meet only through the redirect, the note and the public log.
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { multibaseDecode, resolveDIDFromLog, type DIDDoc, type DIDLog, type DIDLogEntry, type Verifier } from "didwebvh-ts";
import { getFetchGuard, isLoopbackHttpUrl, loopbackFetch, type FetchGuard } from "../../shared/fetch/index.js";

export const DID_CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;
const SEGMENT = /^[A-Za-z0-9._~-]{1,128}$/;
const HOSTNAME = /^(?:[a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}$/;

/** A did:webvh split into what the River checks. */
export interface WebvhDid {
  did: string;
  scid: string;
  /** host[:port], lowercased and decoded (`id.mosaic.social`, `localhost:3001`). */
  host: string;
  path: string[];
}

/** Parses `did:webvh:{SCID}:{host}[:{path}…]`; undefined for anything else. */
export function parseWebvhDid(did: unknown): WebvhDid | undefined {
  if (typeof did !== "string" || did.length > 512) return undefined;
  const parts = did.split(":");
  if (parts.length < 4 || parts[0] !== "did" || parts[1] !== "webvh") return undefined;
  const [, , scid, rawHost, ...path] = parts;
  if (!scid || !/^[A-Za-z0-9]{16,128}$/.test(scid)) return undefined;
  // A port is part of the host, encoded as %3A (did:webvh 1.0 §3.4); nothing else is encoded.
  const host = (rawHost ?? "").replace(/%3A/gi, ":").toLowerCase();
  const [hostname, port, extra] = host.split(":");
  if (extra !== undefined || !hostname || !HOSTNAME.test(hostname)) return undefined;
  if (port !== undefined && !/^[1-9][0-9]{0,4}$/.test(port)) return undefined;
  if (!path.every((segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..")) return undefined;
  return { did, scid, host, path };
}

/** Where the log lives: https://{host}/{path}/did.jsonl, or /.well-known/did.jsonl with no path. */
export function didLogUrl(parsed: WebvhDid): string {
  const path = parsed.path.length > 0 ? parsed.path.join("/") : ".well-known";
  return `https://${parsed.host}/${path}/did.jsonl`;
}

/** True when the DID's host (with its port, if any) is listed in TRUSTED_DID_HOSTS. */
export function isTrustedHost(parsed: WebvhDid, trusted: readonly string[]): boolean {
  return trusted.some((host) => host.trim().toLowerCase() === parsed.host);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host.split(":")[0] ?? "");
}

/** The current state of a verified DID log. */
export interface ResolvedDid {
  did: string;
  scid: string;
  doc: DIDDoc;
  deactivated: boolean;
}

export interface ResolverDeps {
  guard?: FetchGuard;
  /** Reads a loopback log over http (test-only); default src/shared/fetch/loopback.ts. */
  loopback?: (url: string) => Promise<Response>;
  /** Whether to use the loopback path for a trusted loopback host (env.testDidLoopback). */
  allowLoopback?: boolean;
  now?: () => number;
}

export class DidResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DidResolutionError";
  }
}

/** Verifies the log's eddsa-jcs-2022 proofs with node:crypto. */
const verifier: Verifier = {
  async verify(signature, message, publicKey) {
    try {
      return verify(null, message, ed25519FromRaw(publicKey), signature);
    } catch {
      return false;
    }
  },
};

export function ed25519FromRaw(raw: Uint8Array): KeyObject {
  if (raw.length !== 32) throw new Error("An Ed25519 public key is 32 bytes");
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") }, format: "jwk" });
}

/** An Ed25519 multikey (`z6Mk…`: base58btc of 0xed01 || key) as a public key; throws otherwise. */
export function ed25519FromMultikey(multikey: unknown): KeyObject {
  if (typeof multikey !== "string" || !/^z[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(multikey)) {
    throw new Error("Not a base58btc multikey");
  }
  const { bytes } = multibaseDecode(multikey);
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error("Not an Ed25519 multikey");
  return ed25519FromRaw(bytes.slice(2));
}

function parseJsonl(text: string): DIDLog {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0 || lines.length > 1000) throw new DidResolutionError("The DID log is empty or too long");
  try {
    return lines.map((line) => JSON.parse(line) as DIDLogEntry);
  } catch {
    throw new DidResolutionError("The DID log is not JSON lines");
  }
}

/** Resolves trusted did:webvh DIDs through the fetch guard, with a 10-minute cache. */
export class DidResolver {
  private readonly cache = new Map<string, { at: number; resolved: ResolvedDid }>();

  constructor(private readonly deps: ResolverDeps = {}) {}

  clear(): void {
    this.cache.clear();
  }

  /**
   * The current document of a DID whose host the caller already checked against TRUSTED_DID_HOSTS.
   * `fresh` skips the cache (and refreshes it).
   */
  async resolve(parsed: WebvhDid, options: { fresh?: boolean } = {}): Promise<ResolvedDid> {
    const url = didLogUrl(parsed);
    const now = (this.deps.now ?? Date.now)();
    const hit = this.cache.get(url);
    if (!options.fresh && hit && now - hit.at < DID_CACHE_MS && hit.resolved.did === parsed.did) {
      return hit.resolved;
    }
    const text = await this.read(url, parsed);
    const log = parseJsonl(text);
    const result = await resolveDIDFromLog(log, { verifier, witnessProofs: [], scid: parsed.scid });
    if (result.meta.error || !result.doc) throw new DidResolutionError("The DID log does not verify");
    if (result.meta.scid !== parsed.scid) throw new DidResolutionError("The DID log's SCID differs");
    const resolved: ResolvedDid = {
      did: result.did,
      scid: result.meta.scid,
      doc: result.doc,
      deactivated: Boolean(result.meta.deactivated),
    };
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(url, { at: now, resolved });
    return resolved;
  }

  private async read(url: string, parsed: WebvhDid): Promise<string> {
    let res: Response;
    if (isLoopbackHost(parsed.host) && (this.deps.allowLoopback ?? false)) {
      const local = url.replace(/^https:/, "http:");
      if (!isLoopbackHttpUrl(local)) throw new DidResolutionError("Not a loopback URL");
      res = await (this.deps.loopback ?? loopbackFetch)(local);
    } else {
      res = await (this.deps.guard ?? getFetchGuard()).fetch(url, { headers: { accept: "text/jsonl, application/jsonl" } });
    }
    if (res.status !== 200) throw new DidResolutionError(`The DID log answered ${res.status}`);
    return res.text();
  }
}

/**
 * The Ed25519 key of the authentication method `kid` names in a resolved document, or undefined
 * when the document doesn't list `kid` under authentication with a usable key. Relative ids
 * (`#key-1`) are read against the DID. A key in the note's header is never used.
 */
export function authenticationKey(resolved: ResolvedDid, kid: string): KeyObject | undefined {
  const absolute = (id: unknown): string | undefined =>
    typeof id !== "string" ? undefined : id.startsWith("#") ? `${resolved.did}${id}` : id;
  const methods = (resolved.doc.verificationMethod ?? []) as unknown as Array<Record<string, unknown>>;
  for (const entry of (resolved.doc.authentication ?? []) as unknown[]) {
    const method =
      typeof entry === "string"
        ? methods.find((vm) => absolute(vm.id) === absolute(entry))
        : (entry as Record<string, unknown> | null);
    if (!method || absolute(method.id) !== kid) continue;
    if (typeof entry === "string" && absolute(entry) !== kid) continue;
    if (method.type !== "Multikey" && method.type !== "Ed25519VerificationKey2020") continue;
    try {
      return ed25519FromMultikey(method.publicKeyMultibase);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
