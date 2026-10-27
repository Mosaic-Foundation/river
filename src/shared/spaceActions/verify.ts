// The reference verifier (space-actions-1 section 4): how a space checks a signed action, in the
// spec's order, stopping at the first failure. A pure function: the DID resolver, the clock and
// the stores are handed in, and the space's own rules (steps 10 to 13: blocks, the target,
// membership, limits and moderation) are its `decide` callback. Spaces may port it (AGPL-3.0).
//
//   1. Content-Type application/jwt; a compact JWS of at most 16 KB          malformed
//   2. alg exactly EdDSA, typ exactly mosaic-action+jwt, no crit             bad_type
//   3. iss == sub, a did:webvh; kid is iss, '#', a fragment                  untrusted_did
//   4. the DID's host is in did_hosts (src/shared/hosts/), before any request untrusted_did
//   5. aud, htm and htu exactly the manifest's                               wrong_audience
//   6. iat ≤ now + 60, exp ≥ now − 60, 0 ≤ exp − iat ≤ 300                   expired
//   7. the current DID document's assertionMethod key for kid verifies it;  bad_signature,
//      one fresh read per DID per minute when a cached document fails       did_unavailable
//   8. act matches 3.4, and the other claims 3.3, with no unknown fields     invalid_action
//   9. (iss, ref) is claimed atomically: a stored answer for the same act   ref_conflict,
//      is returned as is, another act is ref_conflict, one being answered   replayed,
//      now is unavailable (Retry-After 5); a new ref with a used jti is     unavailable
//      replayed
//  10-13. the space's decide()
//
// Afterwards the answer is stored against (iss, ref) for 24 hours when it is final (201, 202 or
// FINAL_REFUSALS), keyed by the act as signed; a retryable refusal (or a decide() that throws)
// releases the ref, so the same action can succeed later (3.6). Nothing here logs a JWS.
import { verify as verifySignature } from "node:crypto";
import { hostInList } from "../hosts/index.js";
import { checkAct } from "./act.js";
import { DidUnavailableError, assertionKey, parseWebvhDid, type DidDocumentResolver, type ResolvedDidDocument } from "./did.js";
import {
  ACTION_TYP,
  ALG,
  ASSURANCES,
  CONTENT_TYPE,
  FINAL_REFUSALS,
  JTI_GRACE_S,
  LEEWAY_S,
  MAX_BODY_BYTES,
  MAX_LIFETIME_S,
  MAX_MESSAGE_LENGTH,
  PROBLEM_CONTENT_TYPE,
  REFUSALS,
  REF_WINDOW_S,
  type ActionAnswer,
  type ActionClaims,
  type ActionHeader,
  type ActionProblem,
  type ManifestActions,
  type RefusalCode,
} from "./types.js";

/** Fresh DID log reads (step 7's second look): at most one per DID in this many seconds. */
export const FRESH_INTERVAL_S = 60;

const CLAIMS = ["iss", "sub", "aud", "htm", "htu", "iat", "exp", "jti", "client", "assurance", "act"] as const;
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const JTI = /^[A-Za-z0-9_-]{22}$/;

/** What the space answers: a status, a JSON body and its content type, and Retry-After if any. */
export interface Outcome {
  status: number;
  contentType: "application/json" | typeof PROBLEM_CONTENT_TYPE;
  body: ActionAnswer | ActionProblem;
  retryAfter?: number;
}

const TITLES: Record<RefusalCode, string> = {
  malformed: "Not a signed action",
  invalid_action: "The action isn't valid",
  bad_type: "Not an action JWS",
  untrusted_did: "This DID isn't accepted here",
  wrong_audience: "Signed for somewhere else",
  expired: "Outside the time window",
  bad_signature: "The signature doesn't verify",
  not_member: "Not a member yet",
  not_eligible: "Not allowed",
  assurance_required: "A passkey check is needed",
  blocked: "Blocked",
  unknown_target: "No such target",
  replayed: "Already used",
  ref_conflict: "That ref was used for another action",
  closed: "Closed",
  too_long: "Too long",
  not_accepted: "Not accepted",
  not_withdrawable: "Can't be withdrawn",
  rate_limited: "Too many",
  did_unavailable: "The DID couldn't be read just now",
  unavailable: "Not taking actions just now",
};

function clip(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const chars = [...text];
  return chars.length <= MAX_MESSAGE_LENGTH ? text : chars.slice(0, MAX_MESSAGE_LENGTH).join("");
}

/** A refusal as a problem document (RFC 9457; 3.5). */
export function refusal(code: RefusalCode, options: { detail?: string; join?: string; retryAfter?: number } = {}): Outcome {
  const body: ActionProblem = { type: "about:blank", title: TITLES[code], status: REFUSALS[code], code };
  const detail = clip(options.detail);
  if (detail !== undefined) body.detail = detail;
  if (options.join !== undefined) body.join = options.join;
  const outcome: Outcome = { status: REFUSALS[code], contentType: PROBLEM_CONTENT_TYPE, body };
  if (options.retryAfter !== undefined) outcome.retryAfter = options.retryAfter;
  return outcome;
}

/** An accepted (201) or held (202) answer. */
export function answer(body: ActionAnswer): Outcome {
  const kept: ActionAnswer = { ...body };
  if (kept.message !== undefined) kept.message = clip(kept.message);
  return { status: body.status === "accepted" ? 201 : 202, contentType: "application/json", body: kept };
}

/** True when an outcome is one a space stores against `(iss, ref)` (3.6). */
export function isFinal(outcome: Outcome): boolean {
  if (outcome.status === 201 || outcome.status === 202) return true;
  const code = (outcome.body as Partial<ActionProblem>).code;
  return code !== undefined && FINAL_REFUSALS.includes(code);
}

/** What a space holds for `(iss, ref)` when a request claims it (step 9). */
export type RefClaim =
  /** Nothing yet: this request now holds the ref until it settles it. */
  | { state: "claimed" }
  /** Another request with this ref is being answered now. */
  | { state: "pending"; actKey: string }
  /** A final answer within 24 hours. */
  | { state: "stored"; actKey: string; outcome: Outcome };

/** The space's stores. A database in a real space; MemoryActionStores in tests. */
export interface ActionStores {
  /**
   * Atomically claims `(iss, ref)` for a request answering `actKey`, until `pendingUntil`, unless a
   * final answer is stored (returned as is) or another request holds it (pending). A database
   * does this in one statement (an insert that does nothing on conflict, then a read), so two
   * requests with one ref never both reach the space's rules.
   */
  claimRef(iss: string, ref: string, actKey: string, now: number, pendingUntil: number): Promise<RefClaim>;
  /** Ends a claim: stores a final answer until `until`, or (outcome undefined) releases the ref. */
  settleRef(iss: string, ref: string, outcome: Outcome | undefined, until: number): Promise<void>;
  /** Records `jti` until `until`; false when it was already recorded and hasn't expired. */
  useJti(jti: string, until: number, now: number): Promise<boolean>;
  /** Counts a fresh DID log read at `now`; false when one happened within FRESH_INTERVAL_S. */
  allowFreshRead(did: string, now: number): Promise<boolean>;
}

/** How long a claim holds a ref while the space answers: long enough for any decide(). */
export const PENDING_S = 120;
/** Retry-After for a request whose ref another request is answering. */
export const PENDING_RETRY_S = 5;

/** A request that passed steps 1 to 9: what the space's own rules (10 to 13) see. */
export interface VerifiedAction {
  /** The compact JWS, which the space keeps with every accepted or held action (section 4). */
  jws: string;
  header: ActionHeader;
  claims: ActionClaims;
  /** The DID's host, decoded. */
  didHost: string;
}

export interface VerifyDeps {
  /** The space's manifest block: `endpoint`, `audience` and `did_hosts`. */
  manifest: Pick<ManifestActions, "endpoint" | "audience" | "did_hosts">;
  resolver: DidDocumentResolver;
  stores: ActionStores;
  /** Seconds since the epoch. */
  now: () => number;
}

export interface ActionRequest {
  /** The request's Content-Type header, if any. */
  contentType: string | null | undefined;
  /** The raw body. */
  body: string | Uint8Array;
}

/** Steps 10 to 13: the space's own rules. Returns an answer() or a refusal(). */
export type Decide = (action: VerifiedAction) => Promise<Outcome>;

class Refused extends Error {
  constructor(readonly outcome: Outcome) {
    super(`Refused: ${(outcome.body as ActionProblem).code}`);
  }
}

function refuse(code: RefusalCode, retryAfter?: number): never {
  throw new Refused(refusal(code, retryAfter === undefined ? {} : { retryAfter }));
}

function decodeSegment(part: string): Record<string, unknown> {
  if (!SEGMENT.test(part)) refuse("malformed");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    refuse("malformed");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuse("malformed");
  return value as Record<string, unknown>;
}

function mediaType(header: string | null | undefined): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase();
}

/** A stable text form of an act, for "the same act" (3.6): keys sorted, recursively. */
export function actKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(actKey).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value as object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${actKey((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function isOrigin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}

function signatureVerifies(resolved: ResolvedDidDocument, kid: string, signingInput: Buffer, signature: Buffer): boolean {
  const key = assertionKey(resolved, kid);
  if (!key || signature.length !== 64) return false;
  try {
    return verifySignature(null, signingInput, key, signature);
  } catch {
    return false;
  }
}

async function resolveOrRefuse(
  resolver: DidDocumentResolver,
  did: NonNullable<ReturnType<typeof parseWebvhDid>>,
  fresh: boolean,
): Promise<ResolvedDidDocument> {
  try {
    return await resolver.resolve(did, { fresh });
  } catch (err) {
    if (err instanceof DidUnavailableError) refuse("did_unavailable", err.retryAfter);
    refuse("bad_signature");
  }
}

/**
 * Steps 1 to 9. Returns the verified action, or an Outcome to answer at once: a refusal, or the
 * stored answer of an earlier request with the same `(iss, ref)` and act.
 */
export async function verifyAction(
  request: ActionRequest,
  deps: VerifyDeps,
): Promise<{ verified: VerifiedAction; claim: Claimed } | { outcome: Outcome }> {
  try {
    return await verifySteps(request, deps);
  } catch (err) {
    if (err instanceof Refused) return { outcome: err.outcome };
    if (err instanceof StoredAnswer) return { outcome: err.outcome };
    throw err;
  }
}

/** A ref this request holds: settle it with settleClaim() once the space has answered. */
export interface Claimed {
  iss: string;
  ref: string;
  /** The act as signed, as actKey() spells it (computed before the space's rules see it). */
  actKey: string;
}

class StoredAnswer extends Error {
  constructor(readonly outcome: Outcome) {
    super("Stored answer");
  }
}

async function verifySteps(request: ActionRequest, deps: VerifyDeps): Promise<{ verified: VerifiedAction; claim: Claimed }> {
  // 1. The body: one compact JWS, at most 16 KB, sent as application/jwt.
  if (mediaType(request.contentType) !== CONTENT_TYPE) refuse("malformed");
  const bytes = typeof request.body === "string" ? Buffer.from(request.body, "utf8") : Buffer.from(request.body);
  if (bytes.length === 0 || bytes.length > MAX_BODY_BYTES) refuse("malformed");
  const jws = bytes.toString("utf8");
  const parts = jws.split(".");
  if (parts.length !== 3 || !SEGMENT.test(parts[2]!)) refuse("malformed");
  const [h, p, s] = parts as [string, string, string];
  const header = decodeSegment(h);
  const claims = decodeSegment(p);

  // 2. The type and algorithm, exactly.
  if (header.alg !== ALG || header.typ !== ACTION_TYP || header.crit !== undefined) refuse("bad_type");

  // 3. Who signed: iss == sub, a did:webvh, and kid one of its fragments.
  const { iss, sub, kid } = { iss: claims.iss, sub: claims.sub, kid: header.kid };
  if (typeof iss !== "string" || iss !== sub) refuse("untrusted_did");
  const did = parseWebvhDid(iss);
  if (!did) refuse("untrusted_did");
  if (typeof kid !== "string" || !kid.startsWith(`${iss}#`) || kid.length === iss.length + 1) refuse("untrusted_did");

  // 4. Only the DID hosts this space trusts, before any request.
  if (!hostInList(did.host, deps.manifest.did_hosts)) refuse("untrusted_did");

  // 5. For this space and this endpoint.
  if (claims.aud !== deps.manifest.audience || claims.htm !== "POST" || claims.htu !== deps.manifest.endpoint) {
    refuse("wrong_audience");
  }

  // 6. Now, with 60 s of leeway either way, for at most 300 s.
  const now = deps.now();
  const { iat, exp } = claims;
  if (typeof iat !== "number" || typeof exp !== "number" || !Number.isInteger(iat) || !Number.isInteger(exp)) {
    refuse("expired");
  }
  if (iat > now + LEEWAY_S || exp < now - LEEWAY_S || exp < iat || exp - iat > MAX_LIFETIME_S) refuse("expired");

  // 7. The key the DID's current document lists under assertionMethod for kid. Any key in the
  //    header is ignored.
  const signingInput = Buffer.from(`${h}.${p}`, "ascii");
  const signature = Buffer.from(s, "base64url");
  let resolved = await resolveOrRefuse(deps.resolver, did, false);
  if (!signatureVerifies(resolved, kid, signingInput, signature)) {
    if (!(await deps.stores.allowFreshRead(iss, now))) refuse("bad_signature");
    resolved = await resolveOrRefuse(deps.resolver, did, true);
    if (!signatureVerifies(resolved, kid, signingInput, signature)) refuse("bad_signature");
  }
  if (resolved.did !== iss || resolved.deactivated) refuse("bad_signature");

  // 8. The action, and the claims around it, exactly as 3.3 and 3.4 define them.
  if (!Object.keys(claims).every((key) => (CLAIMS as readonly string[]).includes(key))) refuse("invalid_action");
  const checked = checkAct(claims.act);
  if (!checked.ok) refuse("invalid_action");
  if (typeof claims.jti !== "string" || !JTI.test(claims.jti)) refuse("invalid_action");
  if (!isOrigin(claims.client)) refuse("invalid_action");
  if (!(ASSURANCES as readonly unknown[]).includes(claims.assurance)) refuse("invalid_action");

  // 9. Idempotency, then replay (3.6). The ref is claimed atomically, so a retry sent while the
  //    first request is still being answered waits instead of being recorded twice.
  const ref = checked.act.ref;
  const key = actKey(checked.act);
  const claim = await deps.stores.claimRef(iss, ref, key, now, now + PENDING_S);
  if (claim.state !== "claimed") {
    if (claim.actKey !== key) refuse("ref_conflict");
    if (claim.state === "stored") throw new StoredAnswer(claim.outcome);
    refuse("unavailable", PENDING_RETRY_S);
  }
  if (!(await deps.stores.useJti(claims.jti, exp + JTI_GRACE_S, now))) {
    await deps.stores.settleRef(iss, ref, undefined, now);
    refuse("replayed");
  }

  return {
    verified: { jws, header: header as unknown as ActionHeader, claims: claims as unknown as ActionClaims, didHost: did.host },
    claim: { iss, ref, actKey: key },
  };
}

/** Ends a claim with the space's answer: stored when final (3.6), released otherwise. */
export async function settleClaim(stores: ActionStores, claim: Claimed, outcome: Outcome | undefined, now: number): Promise<void> {
  if (outcome && isFinal(outcome)) await stores.settleRef(claim.iss, claim.ref, outcome, now + REF_WINDOW_S);
  else await stores.settleRef(claim.iss, claim.ref, undefined, now);
}

/**
 * The whole of section 4: steps 1 to 9 here, 10 to 13 in `decide`, and the answer stored against
 * `(iss, ref)` when it is final.
 */
export async function handleAction(request: ActionRequest, deps: VerifyDeps, decide: Decide): Promise<Outcome> {
  const result = await verifyAction(request, deps);
  if ("outcome" in result) return result.outcome;
  let outcome: Outcome | undefined;
  try {
    outcome = await decide(result.verified);
    return outcome;
  } finally {
    await settleClaim(deps.stores, result.claim, outcome, deps.now());
  }
}
