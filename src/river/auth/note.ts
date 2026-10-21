// The sign-in callback's checks (spec 4.6 step 4, exactly; check 11). Pure apart from the two
// things it is handed: consuming the attempt (the database) and resolving the DID (the network),
// so unit tests run every refusal with test keys and a test DID log.
//
//   1. The state cookie equals `state` (compared in constant time). Nothing is consumed otherwise.
//   2. The auth_attempts row is consumed atomically; missing, used or expired fails.
//   3. The note is a compact JWS whose header says alg EdDSA, exactly, and names a kid.
//   4. iss == sub, a did:webvh; kid starts with that DID and a '#'.
//   5. The DID's host is in TRUSTED_DID_HOSTS (checked before any request).
//   6. aud is the River's origin; nonce is the attempt's; iat not in the future and exp not passed,
//      with 60 s leeway (and a lifetime of at most 10 minutes).
//   7. The DID is resolved through the fetch guard (cached 10 minutes), its log verified, and the
//      signature checked with the key the CURRENT document lists under authentication for kid.
//      Any key in the header is ignored. If a cached document doesn't verify the note, the log is
//      read once more, fresh (a DID re-keyed by recover-dids within the cache window).
//
// Every failure is a NoteError with a short reason code for the log line; the reader sees only
// "401". The note itself is never logged or echoed.
import { timingSafeEqual, verify } from "node:crypto";
import {
  DidResolutionError,
  authenticationKey,
  isTrustedHost,
  parseWebvhDid,
  type DidResolver,
  type ResolvedDid,
  type WebvhDid,
} from "./did.js";

export const LEEWAY_S = 60;
export const MAX_LIFETIME_S = 600;
const MAX_NOTE_LENGTH = 8192;

export type NoteFailure =
  | "state_cookie"
  | "attempt"
  | "malformed"
  | "alg"
  | "iss_sub"
  | "kid"
  | "untrusted_host"
  | "aud"
  | "nonce"
  | "iat"
  | "exp"
  | "resolve"
  | "deactivated"
  | "no_key"
  | "signature";

export class NoteError extends Error {
  constructor(readonly reason: NoteFailure) {
    super(`Sign-in refused: ${reason}`);
    this.name = "NoteError";
  }
}

export interface VerifyInput {
  state: unknown;
  note: unknown;
  /** The state from the signed cookie, if any. */
  cookieState: string | undefined;
}

export interface VerifyDeps {
  /** Consumes the attempt for this state; returns its nonce, or undefined when unknown or used. */
  consumeAttempt: (state: string) => Promise<string | undefined>;
  resolver: Pick<DidResolver, "resolve">;
  /** RIVER_PUBLIC_ORIGIN: the note's audience. */
  audience: string;
  trustedHosts: readonly string[];
  /** Seconds since the epoch. */
  now: () => number;
}

export interface VerifiedNote {
  did: string;
  scid: string;
}

const OPAQUE = /^[A-Za-z0-9_-]{32,128}$/;

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

function decodeJson(part: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new NoteError("malformed");
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new NoteError("malformed");
  }
}

interface ParsedNote {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: Buffer;
  signature: Buffer;
}

function parseNote(note: unknown): ParsedNote {
  if (typeof note !== "string" || note.length === 0 || note.length > MAX_NOTE_LENGTH) throw new NoteError("malformed");
  const parts = note.split(".");
  if (parts.length !== 3 || !parts[2] || !/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new NoteError("malformed");
  const [h, p, s] = parts as [string, string, string];
  return {
    header: decodeJson(h),
    payload: decodeJson(p),
    signingInput: Buffer.from(`${h}.${p}`, "ascii"),
    signature: Buffer.from(s, "base64url"),
  };
}

function verifies(parsed: ParsedNote, resolved: ResolvedDid, kid: string): boolean {
  const key = authenticationKey(resolved, kid);
  if (!key) return false;
  if (parsed.signature.length !== 64) return false;
  try {
    return verify(null, parsed.signingInput, key, parsed.signature);
  } catch {
    return false;
  }
}

/** Runs every check of spec 4.6 step 4; returns the DID and SCID or throws NoteError. */
export async function verifySignInNote(input: VerifyInput, deps: VerifyDeps): Promise<VerifiedNote> {
  // 1. The browser that started the sign-in.
  const state = typeof input.state === "string" && OPAQUE.test(input.state) ? input.state : undefined;
  if (!state || !input.cookieState || !sameText(state, input.cookieState)) throw new NoteError("state_cookie");

  // 2. One use of the attempt, whatever happens next.
  const nonce = await deps.consumeAttempt(state);
  if (nonce === undefined) throw new NoteError("attempt");

  // 3. The JWS and its algorithm, fixed.
  const parsed = parseNote(input.note);
  if (parsed.header.alg !== "EdDSA") throw new NoteError("alg");
  if (parsed.header.crit !== undefined) throw new NoteError("malformed");
  const { iss, sub, aud, iat, exp } = parsed.payload;

  // 4. Who signed: iss == sub, a did:webvh, and kid one of its fragments.
  if (typeof iss !== "string" || iss !== sub) throw new NoteError("iss_sub");
  const did: WebvhDid | undefined = parseWebvhDid(iss);
  if (!did) throw new NoteError("iss_sub");
  const kid = parsed.header.kid;
  if (typeof kid !== "string" || !kid.startsWith(`${iss}#`) || kid.length === iss.length + 1) {
    throw new NoteError("kid");
  }

  // 5. Only trusted DID hosts, before any request.
  if (!isTrustedHost(did, deps.trustedHosts)) throw new NoteError("untrusted_host");

  // 6. For this River, this attempt, now.
  if (typeof aud !== "string" || aud !== deps.audience) throw new NoteError("aud");
  if (typeof parsed.payload.nonce !== "string" || !sameText(parsed.payload.nonce, nonce)) throw new NoteError("nonce");
  const now = deps.now();
  if (typeof iat !== "number" || !Number.isFinite(iat) || iat > now + LEEWAY_S) throw new NoteError("iat");
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp < now - LEEWAY_S) throw new NoteError("exp");
  if (exp < iat || exp - iat > MAX_LIFETIME_S) throw new NoteError("exp");

  // 7. The key the DID's current document lists for kid.
  let resolved: ResolvedDid;
  try {
    resolved = await deps.resolver.resolve(did);
  } catch (err) {
    if (err instanceof DidResolutionError) throw new NoteError("resolve");
    throw new NoteError("resolve");
  }
  if (!verifies(parsed, resolved, kid)) {
    try {
      resolved = await deps.resolver.resolve(did, { fresh: true });
    } catch {
      throw new NoteError("resolve");
    }
    if (!authenticationKey(resolved, kid)) throw new NoteError("no_key");
    if (!verifies(parsed, resolved, kid)) throw new NoteError("signature");
  }
  if (resolved.did !== iss) throw new NoteError("resolve");
  if (resolved.deactivated) throw new NoteError("deactivated");
  return { did: resolved.did, scid: resolved.scid };
}
