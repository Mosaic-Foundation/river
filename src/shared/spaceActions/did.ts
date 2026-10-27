// What the reference verifier needs from a did:webvh (space-actions-1 4 steps 3, 4 and 7): the
// DID's host, and the Ed25519 key its current document lists under `assertionMethod` for a `kid`.
// Resolving the log is the space's own outbound request, so the verifier is handed a resolver
// (DidDocumentResolver) and never reads the network itself.
//
// The parsing rules match the River's sign-in (src/river/auth/did.ts; DECISIONS "What 'kid
// starts with that DID' allows"); this copy reads `assertionMethod`, never `authentication`
// (ADR-012 item 5: an action is a statement, a sign-in a proof of control).
import { createPublicKey, type KeyObject } from "node:crypto";
import { multibaseDecode } from "didwebvh-ts";

const SEGMENT = /^[A-Za-z0-9._~-]{1,128}$/;
const HOSTNAME = /^(?:[a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}$/;

/** A did:webvh's parts, with its host decoded (`id.mosaic.social`, `localhost:3001`). */
export interface ParsedWebvhDid {
  did: string;
  scid: string;
  host: string;
  path: string[];
}

/** Parses `did:webvh:{SCID}:{host}[:{path}…]`; undefined for anything else. */
export function parseWebvhDid(did: unknown): ParsedWebvhDid | undefined {
  if (typeof did !== "string" || did.length > 512) return undefined;
  const parts = did.split(":");
  if (parts.length < 4 || parts[0] !== "did" || parts[1] !== "webvh") return undefined;
  const [, , scid, rawHost, ...path] = parts;
  if (!scid || !/^[A-Za-z0-9]{16,128}$/.test(scid)) return undefined;
  // A port is part of the host, encoded as %3A (did:webvh 1.0 §3.4); nothing else is encoded.
  // ASCII only, checked before lowercasing (toLowerCase() maps the Kelvin sign to "k").
  const encoded = rawHost ?? "";
  if (!/^[\x21-\x7e]+$/.test(encoded)) return undefined;
  const host = encoded.replace(/%3A/gi, ":").toLowerCase();
  // Only the canonical spelling (lowercase, a port as %3A): another spelling of a real DID would
  // miss every cache keyed on the DID and get a fresh log read each time.
  if (encoded !== host.replace(":", "%3A")) return undefined;
  const [hostname, port, extra] = host.split(":");
  if (extra !== undefined || !hostname || !HOSTNAME.test(hostname)) return undefined;
  if (port !== undefined && !/^[1-9][0-9]{0,4}$/.test(port)) return undefined;
  if (!path.every((segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..")) return undefined;
  return { did, scid, host, path };
}

/** A DID document as resolved from its verified log: only the parts the verifier reads. */
export interface DidDocument {
  id?: unknown;
  verificationMethod?: unknown;
  assertionMethod?: unknown;
}

/** The current state of a DID, from its verified log. */
export interface ResolvedDidDocument {
  did: string;
  doc: DidDocument;
  deactivated: boolean;
}

/**
 * Reads and verifies a DID's log (through the space's fetch guard) and returns its current
 * document. `fresh` skips any cache. Throw DidUnavailableError when the log couldn't be read just
 * now (a timeout, a 5xx); any other failure (no such DID, a log that doesn't verify) is final.
 */
export interface DidDocumentResolver {
  resolve(did: ParsedWebvhDid, options: { fresh: boolean }): Promise<ResolvedDidDocument>;
}

export class DidUnavailableError extends Error {
  /** Seconds the space should ask the client to wait (Retry-After). */
  constructor(readonly retryAfter = 60) {
    super("The DID log couldn't be read just now");
    this.name = "DidUnavailableError";
  }
}

function ed25519FromMultikey(multikey: unknown): KeyObject | undefined {
  if (typeof multikey !== "string" || !/^z[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(multikey)) return undefined;
  try {
    const { bytes } = multibaseDecode(multikey);
    if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) return undefined;
    const x = Buffer.from(bytes.slice(2)).toString("base64url");
    return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
  } catch {
    return undefined;
  }
}

/**
 * The Ed25519 key of the verification method `kid` names under the document's `assertionMethod`,
 * or undefined. Relative ids (`#key-1`) are read against the DID. A key listed only under
 * `authentication` (or anywhere else) is never returned.
 */
export function assertionKey(resolved: ResolvedDidDocument, kid: string): KeyObject | undefined {
  const absolute = (id: unknown): string | undefined =>
    typeof id !== "string" ? undefined : id.startsWith("#") ? `${resolved.did}${id}` : id;
  const methods = Array.isArray(resolved.doc.verificationMethod)
    ? (resolved.doc.verificationMethod as unknown[]).filter(
        (vm): vm is Record<string, unknown> => vm !== null && typeof vm === "object",
      )
    : [];
  const listed = Array.isArray(resolved.doc.assertionMethod) ? (resolved.doc.assertionMethod as unknown[]) : [];
  for (const entry of listed) {
    let method: Record<string, unknown> | undefined;
    if (typeof entry === "string") {
      if (absolute(entry) !== kid) continue;
      method = methods.find((vm) => absolute(vm.id) === kid);
    } else if (entry !== null && typeof entry === "object") {
      method = entry as Record<string, unknown>;
      if (absolute(method.id) !== kid) continue;
    }
    if (!method) continue;
    if (method.type !== "Multikey" && method.type !== "Ed25519VerificationKey2020") continue;
    return ed25519FromMultikey(method.publicKeyMultibase);
  }
  return undefined;
}
