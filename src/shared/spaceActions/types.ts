// Mosaic Space Actions 0.1: the protocol's names, shapes and refusal codes
// (docs/spec/space-actions-1.md sections 2 and 3; ADR-012). Shared by the River (the client),
// Mosaic ID (the signer) and the reference verifier any space may port (AGPL-3.0).

export const PROTOCOL = "mosaic-space-actions/0.1";
/** The `typ` of an action JWS (3.2). */
export const ACTION_TYP = "mosaic-action+jwt";
/** The `typ` sign-in notes gain (5.5); an action verifier refuses it like any other. */
export const SIGNIN_TYP = "mosaic-signin+jwt";
export const ALG = "EdDSA";
export const CONTENT_TYPE = "application/jwt";
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** The largest request body a space accepts (3.1). */
export const MAX_BODY_BYTES = 16 * 1024;
/** `exp - iat` at most (3.3); Mosaic ID signs for ACTION_LIFETIME_S. */
export const MAX_LIFETIME_S = 300;
export const ACTION_LIFETIME_S = 120;
/** Clock leeway on `iat` and `exp` (4 step 6). */
export const LEEWAY_S = 60;
/** How long a space keeps a `(iss, ref)` answer (3.6). */
export const REF_WINDOW_S = 24 * 60 * 60;
/** A `jti` is remembered until `exp` plus this (3.6). */
export const JTI_GRACE_S = 60;
/** Comment length (3.4 and 2.2): at most 5,000 characters; a target's default is 2,000. */
export const MAX_COMMENT_LENGTH = 5000;
export const DEFAULT_MAX_LENGTH = 2000;
/** Poll choices a target may list (2.2). */
export const MIN_POLL_CHOICES = 2;
export const MAX_POLL_CHOICES = 20;
/** `detail` and `message` in answers (3.5). */
export const MAX_MESSAGE_LENGTH = 300;

/** The verbs a space may advertise (2.1). */
export const VERBS = ["comment", "support", "rsvp", "poll_answer"] as const;
export type Verb = (typeof VERBS)[number];
/** Every `act.verb`: the four, and `withdraw` of an earlier one (3.4). */
export const ACT_VERBS = [...VERBS, "withdraw"] as const;
export type ActVerb = (typeof ACT_VERBS)[number];
export const RSVP_ANSWERS = ["yes", "no", "maybe"] as const;
export type RsvpAnswer = (typeof RSVP_ANSWERS)[number];
export const ASSURANCES = ["grant", "passkey"] as const;
export type Assurance = (typeof ASSURANCES)[number];

export function isVerb(value: unknown): value is Verb {
  return typeof value === "string" && (VERBS as readonly string[]).includes(value);
}

interface ActBase {
  target: string;
  /** The client's idempotency key: a UUID, the same on every retry of one action (3.4). */
  ref: string;
}
export interface CommentAct extends ActBase {
  verb: "comment";
  content: string;
  lang?: string;
}
export interface SupportAct extends ActBase {
  verb: "support";
}
export interface RsvpAct extends ActBase {
  verb: "rsvp";
  answer: RsvpAnswer;
}
export interface PollAnswerAct extends ActBase {
  verb: "poll_answer";
  choices: string[];
}
export interface WithdrawAct extends ActBase {
  verb: "withdraw";
  withdraws: Verb;
}
export type Act = CommentAct | SupportAct | RsvpAct | PollAnswerAct | WithdrawAct;

/** The JWS header (3.2). */
export interface ActionHeader {
  alg: typeof ALG;
  typ: typeof ACTION_TYP;
  kid: string;
}

/** The JWS claims (3.3). */
export interface ActionClaims {
  iss: string;
  sub: string;
  aud: string;
  htm: "POST";
  htu: string;
  iat: number;
  exp: number;
  jti: string;
  client: string;
  assurance: Assurance;
  act: Act;
}

/** The manifest's `actions` block (2.1). */
export interface ManifestActions {
  protocol: typeof PROTOCOL;
  endpoint: string;
  audience: string;
  did_hosts: string[];
  verbs: Verb[];
  join?: string;
  terms?: string;
}

/** A successful answer (3.5): 201 `accepted` or 202 `held`. */
export interface ActionAnswer {
  status: "accepted" | "held";
  id: string;
  url?: string;
  withdrawable: boolean;
  ref: string;
  message?: string;
}

/** Every refusal code of 3.5, with its HTTP status. */
export const REFUSALS = {
  malformed: 400,
  invalid_action: 400,
  bad_type: 401,
  untrusted_did: 401,
  wrong_audience: 401,
  expired: 401,
  bad_signature: 401,
  not_member: 403,
  not_eligible: 403,
  assurance_required: 403,
  blocked: 403,
  unknown_target: 404,
  replayed: 409,
  ref_conflict: 409,
  closed: 410,
  too_long: 413,
  not_accepted: 422,
  not_withdrawable: 422,
  rate_limited: 429,
  did_unavailable: 503,
  unavailable: 503,
} as const;
export type RefusalCode = keyof typeof REFUSALS;

/**
 * The refusals a space stores against `(iss, ref)` as final (3.6), with 201 and 202. Every other
 * refusal is either retryable (never stored, so the same `ref` can succeed later) or decided
 * before the `ref` is looked at.
 */
export const FINAL_REFUSALS: readonly RefusalCode[] = [
  "blocked",
  "unknown_target",
  "closed",
  "not_accepted",
  "too_long",
  "not_withdrawable",
  "not_eligible",
];

/** The problem document a space answers a refusal with (RFC 9457; 3.5). */
export interface ActionProblem {
  type: "about:blank";
  title: string;
  status: number;
  code: RefusalCode;
  detail?: string;
  join?: string;
}

export function isRefusalCode(value: unknown): value is RefusalCode {
  return typeof value === "string" && Object.hasOwn(REFUSALS, value);
}
