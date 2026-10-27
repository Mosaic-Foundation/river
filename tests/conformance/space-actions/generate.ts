// Builds the Mosaic Space Actions 0.1 test vectors (space-actions-1 section 8). Deterministic:
// fixed key seeds, a fixed clock, fixed refs and jtis, and Ed25519's deterministic signatures,
// so `npx tsx scripts/space-actions-vectors.ts` rewrites vectors.json byte for byte, and a unit
// test fails if the file and this builder drift apart.
//
// Everything here is for tests only. The keys are published in the file on purpose and must never
// be trusted anywhere real; every host is under the reserved `.example` TLD (RFC 2606), except
// the `hosts` cases, which only compare names.
import { sign as edSign } from "node:crypto";
import { actionClaims } from "../../../src/shared/spaceActions/index.js";
import type { Act } from "../../../src/shared/spaceActions/index.js";
import { makeActionDid, type TestActionDid } from "../../support/spaceActions/testDid.js";
import type { Vectors, VectorCase, VectorDid, VectorRequest } from "./types.js";

export const NOW = 1_793_050_000; // 2026-10-26T20:06:40Z
const CREATED = new Date("2026-10-01T00:00:00Z");
const SPACE = "https://stand-in.example";
export const MANIFEST_URL = `${SPACE}/.well-known/civic.json`;
const ENDPOINT = `${SPACE}/actions`;
const AUDIENCE = "did:web:stand-in.example";
const DID_HOST = "id.test.example";
const CLIENT = "https://river.test.example";

/** The stand-in space's targets (tests/support/standInSpace/). */
export const TARGETS = {
  proposal: `${SPACE}/proposals/prop_1`,
  event: `${SPACE}/events/evt_1`,
  poll: `${SPACE}/polls/poll_1`,
} as const;

/** What a space answers with for an action: its id is `{SPACE}/actions/{ref}` at the stand-in. */
export function actionId(ref: string): string {
  return `${SPACE}/actions/${ref}`;
}

const seed = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

/** A fixed UUID per case number, so every request has its own ref. */
function ref(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

/** A fixed 16-byte jti per number. */
function jti(n: number): string {
  return Buffer.from(n.toString(16).padStart(32, "0"), "hex").toString("base64url");
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

interface Sign {
  who: TestActionDid;
  act: Act;
  n: number;
  claims?: Record<string, unknown>;
  header?: Record<string, unknown>;
  /** Sign with this DID's key instead of `who`'s. */
  signer?: TestActionDid;
}

function signed(build: Sign): string {
  const claims: Record<string, unknown> = {
    ...actionClaims({
      did: build.who.did,
      aud: AUDIENCE,
      htu: ENDPOINT,
      client: CLIENT,
      assurance: "grant",
      act: build.act,
      now: NOW,
      jti: jti(build.n),
    }),
    ...build.claims,
  };
  const header: Record<string, unknown> = { alg: "EdDSA", typ: "mosaic-action+jwt", kid: build.who.kid, ...build.header };
  for (const [k, v] of Object.entries(claims)) if (v === undefined) delete claims[k];
  for (const [k, v] of Object.entries(header)) if (v === undefined) delete header[k];
  const input = `${b64(header)}.${b64(claims)}`;
  const key = (build.signer ?? build.who).key.privateKey;
  return `${input}.${edSign(null, Buffer.from(input, "ascii"), key).toString("base64url")}`;
}

function request(body: string, expect: VectorRequest["expect"], contentType = "application/jwt"): VectorRequest {
  return { content_type: contentType, body, expect };
}

function vectorDid(did: TestActionDid, keySeed: string, note: string): VectorDid {
  return { did: did.did, kid: did.kid, log_url: did.logUrl, log: did.jsonl, key_seed: keySeed, note };
}

export async function buildVectors(): Promise<Vectors> {
  const make = (host: string, code: string, k: number, assertion = true) =>
    makeActionDid({ host, code, keySeed: seed(k), recoverySeed: seed(k + 1), created: CREATED, assertion });
  const member = await make(DID_HOST, "member01", 1);
  const authOnly = await make(DID_HOST, "member02", 3, false);
  const floyd = await make(`floyd.${DID_HOST}`, "member03", 5);
  const evil = await make(`evil${DID_HOST}`, "member04", 7);
  const suffixed = await make(`${DID_HOST}.evil.example`, "member05", 9);
  const outsider = await make("id.other.example", "member06", 11);

  const support = (n: number): Act => ({ verb: "support", target: TARGETS.proposal, ref: ref(n) });
  const cases: VectorCase[] = [];
  let n = 0;
  const add = (name: string, step: number, description: string, build: (n: number) => VectorRequest[]) => {
    n += 1;
    cases.push({ name, step, description, requests: build(n) });
  };
  const one = (name: string, step: number, description: string, make: (n: number) => VectorRequest) =>
    add(name, step, description, (k) => [make(k)]);
  const ok = { status: 201 } as const;
  const no = (status: number, code: VectorRequest["expect"]["code"], noDidRequest = false): VectorRequest["expect"] =>
    noDidRequest ? { status, code, no_did_request: true } : { status, code };

  // Valid: one per verb, then the edges of the rules that still pass.
  one("valid-comment", 0, "A comment", (k) =>
    request(signed({ who: member, n: k, act: { verb: "comment", target: TARGETS.proposal, ref: ref(k), content: "Could the skate park stay open until 9 in summer?", lang: "en" } }), ok),
  );
  one("valid-support", 0, "A support", (k) => request(signed({ who: member, n: k, act: support(k) }), ok));
  one("valid-rsvp", 0, "An RSVP", (k) =>
    request(signed({ who: member, n: k, act: { verb: "rsvp", target: TARGETS.event, ref: ref(k), answer: "yes" } }), ok),
  );
  one("valid-poll-answer", 0, "A poll answer", (k) =>
    request(signed({ who: member, n: k, act: { verb: "poll_answer", target: TARGETS.poll, ref: ref(k), choices: ["a"] } }), ok),
  );
  add("valid-withdraw", 0, "A support, then its withdrawal by the id the space returned", (k) => [
    request(signed({ who: member, n: k, act: support(k) }), ok),
    request(signed({ who: member, n: 1000 + k, act: { verb: "withdraw", target: actionId(ref(k)), ref: ref(1000 + k), withdraws: "support" } }), ok),
  ]);
  one("valid-did-on-subdomain", 4, "did_hosts id.test.example covers floyd.id.test.example (a subdomain on a dot boundary)", (k) =>
    request(signed({ who: floyd, n: k, act: support(k) }), ok),
  );
  one("valid-iat-59s-ahead", 6, "iat 59 s in the future", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { iat: NOW + 59, exp: NOW + 120 } }), ok),
  );
  one("valid-exp-59s-past", 6, "exp 59 s in the past", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { iat: NOW - 120, exp: NOW - 59 } }), ok),
  );
  one("valid-lifetime-300s", 6, "exp - iat of exactly 300", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { exp: NOW + 300 } }), ok),
  );
  add("valid-repeat-same-ref", 9, "The same (iss, ref) and act again, with a new jti and assurance: the stored answer", (k) => [
    request(signed({ who: member, n: k, act: support(k) }), ok),
    request(signed({ who: member, n: 1000 + k, act: support(k), claims: { assurance: "passkey" } }), { status: 201, same_as: 0 }),
  ]);

  // 1. malformed
  one("malformed-content-type", 1, "Sent as application/json", (k) =>
    request(signed({ who: member, n: k, act: support(k) }), no(400, "malformed", true), "application/json"),
  );
  one("malformed-not-compact", 1, "Two parts, not three", (k) =>
    request(signed({ who: member, n: k, act: support(k) }).split(".").slice(0, 2).join("."), no(400, "malformed", true)),
  );
  one("malformed-trailing-newline", 1, "A compact JWS followed by a line feed", (k) =>
    request(`${signed({ who: member, n: k, act: support(k) })}\n`, no(400, "malformed", true)),
  );
  one("malformed-too-large", 1, "A body over 16 KB", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { pad: "x".repeat(16_500) } }), no(400, "malformed", true)),
  );

  // 2. bad_type
  one("bad-type-alg", 2, "Header alg ES256 (signed with EdDSA)", (k) =>
    request(signed({ who: member, n: k, act: support(k), header: { alg: "ES256" } }), no(401, "bad_type", true)),
  );
  one("bad-type-no-typ", 2, "No typ, as a sign-in note has", (k) =>
    request(signed({ who: member, n: k, act: support(k), header: { typ: undefined } }), no(401, "bad_type", true)),
  );
  one("bad-type-signin-typ", 2, "typ mosaic-signin+jwt", (k) =>
    request(signed({ who: member, n: k, act: support(k), header: { typ: "mosaic-signin+jwt" } }), no(401, "bad_type", true)),
  );
  one("bad-type-signin-note", 2, "A sign-in note (aud, nonce, no typ) sent as an action", () => {
    const header = { alg: "EdDSA", kid: member.kid };
    const claims = { iss: member.did, sub: member.did, aud: CLIENT, nonce: "n".repeat(43), iat: NOW, exp: NOW + 120 };
    const input = `${b64(header)}.${b64(claims)}`;
    const body = `${input}.${edSign(null, Buffer.from(input, "ascii"), member.key.privateKey).toString("base64url")}`;
    return request(body, no(401, "bad_type", true));
  });

  // 3 and 4. untrusted_did, before any request
  one("untrusted-did-iss-sub", 3, "iss and sub differ", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { sub: authOnly.did } }), no(401, "untrusted_did", true)),
  );
  one("untrusted-did-not-webvh", 3, "iss is a did:web", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { iss: "did:web:id.test.example", sub: "did:web:id.test.example" }, header: { kid: "did:web:id.test.example#key-1" } }), no(401, "untrusted_did", true)),
  );
  one("untrusted-did-kid-prefix", 3, "kid is another DID's text that starts with iss", (k) =>
    request(signed({ who: member, n: k, act: support(k), header: { kid: `${member.did}x#key-1` } }), no(401, "untrusted_did", true)),
  );
  one("untrusted-did-other-host", 4, "A DID at id.other.example, which did_hosts doesn't list", (k) =>
    request(signed({ who: outsider, n: k, act: support(k) }), no(401, "untrusted_did", true)),
  );
  one("untrusted-did-no-dot-boundary", 4, "A DID at evilid.test.example: ends with the entry's text, not on a dot boundary", (k) =>
    request(signed({ who: evil, n: k, act: support(k) }), no(401, "untrusted_did", true)),
  );
  one("untrusted-did-entry-as-prefix", 4, "A DID at id.test.example.evil.example: the entry as a prefix", (k) =>
    request(signed({ who: suffixed, n: k, act: support(k) }), no(401, "untrusted_did", true)),
  );

  // 5. wrong_audience
  one("wrong-audience-aud", 5, "aud of another space", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { aud: "did:web:other.example" } }), no(401, "wrong_audience", true)),
  );
  one("wrong-audience-htu", 5, "htu of another endpoint", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { htu: "https://other.example/actions" } }), no(401, "wrong_audience", true)),
  );
  one("wrong-audience-htm", 5, "htm GET", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { htm: "GET" } }), no(401, "wrong_audience", true)),
  );

  // 6. expired
  one("expired-lifetime-301s", 6, "exp - iat of 301", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { exp: NOW + 301 } }), no(401, "expired", true)),
  );
  one("expired-iat-61s-ahead", 6, "iat 61 s in the future", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { iat: NOW + 61, exp: NOW + 121 } }), no(401, "expired", true)),
  );
  one("expired-exp-61s-past", 6, "exp 61 s in the past", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { iat: NOW - 121, exp: NOW - 61 } }), no(401, "expired", true)),
  );

  // 7. bad_signature
  one("bad-signature-other-key", 7, "Signed by a key that isn't the DID's", (k) =>
    request(signed({ who: member, n: k, act: support(k), signer: floyd }), no(401, "bad_signature")),
  );
  one("bad-signature-authentication-only", 7, "Signed by a key the document lists under authentication only", (k) =>
    request(signed({ who: authOnly, n: k, act: support(k) }), no(401, "bad_signature")),
  );

  // 8. invalid_action
  one("invalid-action-extra-field", 8, "act carries a field 3.4 doesn't define", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { act: { ...support(k), note: "hi" } } }), no(400, "invalid_action")),
  );
  one("invalid-action-unknown-verb", 8, "act.verb like", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { act: { verb: "like", target: TARGETS.proposal, ref: ref(k) } } }), no(400, "invalid_action")),
  );
  one("invalid-action-html", 8, "A comment whose content is HTML", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { act: { verb: "comment", target: TARGETS.proposal, ref: ref(k), content: "<b>hi</b>" } } }), no(400, "invalid_action")),
  );
  one("invalid-action-extra-claim", 8, "A claim 3.3 doesn't define", (k) =>
    request(signed({ who: member, n: k, act: support(k), claims: { nonce: "abc" } }), no(400, "invalid_action")),
  );

  // 9. replay and ref conflicts
  add("replayed-jti", 9, "A new ref with a jti already used", (k) => [
    request(signed({ who: member, n: k, act: support(k) }), ok),
    request(signed({ who: member, n: k, act: { verb: "comment", target: TARGETS.proposal, ref: ref(1000 + k), content: "Hello" } }), no(409, "replayed")),
  ]);
  add("ref-conflict", 9, "The same ref with another act", (k) => [
    request(signed({ who: member, n: k, act: { verb: "rsvp", target: TARGETS.event, ref: ref(k), answer: "yes" } }), ok),
    request(signed({ who: member, n: 1000 + k, act: { verb: "rsvp", target: TARGETS.event, ref: ref(k), answer: "no" } }), no(409, "ref_conflict")),
  ]);

  return {
    protocol: "mosaic-space-actions/0.1",
    note:
      "TEST VECTORS ONLY. The keys below are published on purpose: never trust these DIDs, keys or hosts anywhere real. " +
      "Generated by scripts/space-actions-vectors.ts; do not edit by hand.",
    now: NOW,
    manifest_url: MANIFEST_URL,
    manifest: {
      space: { id: AUDIENCE, type: "civic.hub" },
      actions: {
        protocol: "mosaic-space-actions/0.1",
        endpoint: ENDPOINT,
        audience: AUDIENCE,
        did_hosts: [DID_HOST],
        verbs: ["comment", "support", "rsvp", "poll_answer"],
        join: `${SPACE}/join`,
      },
    },
    dids: [
      vectorDid(member, seed(1), "A member; assertionMethod lists #key-1"),
      vectorDid(authOnly, seed(3), "A member whose document lists #key-1 under authentication only (before a grant)"),
      vectorDid(floyd, seed(5), "On floyd.id.test.example, a subdomain of a did_hosts entry"),
      vectorDid(evil, seed(7), "On evilid.test.example: must never be read (not on a dot boundary)"),
      vectorDid(suffixed, seed(9), "On id.test.example.evil.example: must never be read"),
      vectorDid(outsider, seed(11), "On id.other.example: must never be read"),
    ],
    hosts: [
      { list: ["civic.social"], host: "civic.social", matches: true, note: "the entry itself" },
      { list: ["civic.social"], host: "floyd.civic.social", matches: true, note: "a subdomain on a dot boundary" },
      { list: ["civic.social"], host: "evilcivic.social", matches: false, note: "ends with the entry's text, no dot boundary" },
      { list: ["civic.social"], host: "civic.social.example.com", matches: false, note: "the entry as a prefix" },
      { list: ["civic.social"], host: "a.b.civic.social", matches: true, note: "a deeper subdomain" },
      { list: ["civic.social"], host: "Floyd.Civic.Social", matches: true, note: "case-insensitive" },
      { list: ["civic.social"], host: "civic.social.", matches: false, note: "a trailing dot" },
      { list: ["civic.social"], host: "floyd-civic.social", matches: false, note: "a hyphen is not a dot" },
      { list: ["floyd.civic.social"], host: "civic.social", matches: false, note: "a parent of the entry" },
      { list: ["localhost:3001"], host: "localhost:3001", matches: true, note: "a port, as in the DID" },
      { list: ["localhost:3001"], host: "localhost:3002", matches: false, note: "another port" },
      { list: ["civic.social"], host: "civic.social:8443", matches: false, note: "a port the entry doesn't name" },
      { list: ["*.civic.social"], host: "floyd.civic.social", matches: false, note: "wildcards are not entries" },
    ],
    cases,
  };
}
