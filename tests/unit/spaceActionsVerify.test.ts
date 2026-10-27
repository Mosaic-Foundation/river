// The reference verifier (space-actions-1 section 4; checks 1 to 5, unit half): every step's
// refusal, the DID host checked before any request (dot boundary included), assertionMethod
// only, fresh reads, idempotency and replay. Test DIDs are built by didwebvh-ts with seeded test
// keys (tests/support/spaceActions/testDid.ts); no request leaves the process.
import { sign, type KeyObject } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DidUnavailableError,
  MemoryActionStores,
  actionClaims,
  answer,
  handleAction,
  refusal,
  signAction,
  type Act,
  type ActionProblem,
  type Decide,
  type Outcome,
  type VerifyDeps,
} from "../../src/shared/spaceActions/index.js";
import { MapDidResolver, makeActionDid, seededKey, type TestActionDid } from "../support/spaceActions/testDid.js";

const NOW = 1_793_050_000;
const MANIFEST = {
  endpoint: "https://space.test.example/actions",
  audience: "did:web:space.test.example",
  did_hosts: ["id.test.example"],
};
const TARGET = "https://space.test.example/proposals/prop_9";
const REF = "8f1c2b7e-0d4a-4c1e-9a55-1f3b2c6d7e80";
const REF2 = "0b6a1c3e-5f7d-4e2a-8b9c-0d1e2f3a4b5c";
const CREATED = new Date("2026-10-01T00:00:00Z");

const seed = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

let member: TestActionDid;
let authOnly: TestActionDid;
let floyd: TestActionDid;
let evil: TestActionDid;
let suffixed: TestActionDid;

beforeAll(async () => {
  member = await makeActionDid({ host: "id.test.example", code: "member01", keySeed: seed(1), recoverySeed: seed(2), created: CREATED });
  authOnly = await makeActionDid({
    host: "id.test.example",
    code: "member02",
    keySeed: seed(3),
    recoverySeed: seed(4),
    created: CREATED,
    assertion: false,
  });
  floyd = await makeActionDid({ host: "floyd.id.test.example", code: "member03", keySeed: seed(5), recoverySeed: seed(6), created: CREATED });
  evil = await makeActionDid({ host: "evilid.test.example", code: "member04", keySeed: seed(7), recoverySeed: seed(8), created: CREATED });
  suffixed = await makeActionDid({
    host: "id.test.example.evil.example",
    code: "member05",
    keySeed: seed(9),
    recoverySeed: seed(10),
    created: CREATED,
  });
});

let resolver: MapDidResolver;
let stores: MemoryActionStores;
let decisions: number;
let decide: Decide;

beforeEach(() => {
  resolver = new MapDidResolver(() => NOW * 1000);
  for (const did of [member, authOnly, floyd, evil, suffixed]) resolver.serve(did);
  stores = new MemoryActionStores();
  decisions = 0;
  decide = async (action) => {
    decisions += 1;
    return answer({ status: "accepted", id: `${TARGET}/s/${decisions}`, withdrawable: true, ref: action.claims.act.ref });
  };
});

function deps(overrides: Partial<VerifyDeps> = {}): VerifyDeps {
  return { manifest: MANIFEST, resolver, stores, now: () => NOW, ...overrides };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function rawJws(header: unknown, claims: unknown, key: KeyObject): string {
  const input = `${b64(header)}.${b64(claims)}`;
  return `${input}.${sign(null, Buffer.from(input, "ascii"), key).toString("base64url")}`;
}

interface Build {
  who?: TestActionDid;
  act?: Act;
  claims?: Record<string, unknown>;
  header?: Record<string, unknown>;
  key?: KeyObject;
}

/** A signed request; `claims` and `header` override or (with undefined) remove fields. */
function jws(build: Build = {}): string {
  const who = build.who ?? member;
  const claims: Record<string, unknown> = {
    ...actionClaims({
      did: who.did,
      aud: MANIFEST.audience,
      htu: MANIFEST.endpoint,
      client: "https://river.test.example",
      assurance: "grant",
      act: build.act ?? { verb: "support", target: TARGET, ref: REF },
      now: NOW,
    }),
    ...build.claims,
  };
  const header: Record<string, unknown> = { alg: "EdDSA", typ: "mosaic-action+jwt", kid: who.kid, ...build.header };
  for (const [k, v] of Object.entries(claims)) if (v === undefined) delete claims[k];
  for (const [k, v] of Object.entries(header)) if (v === undefined) delete header[k];
  return rawJws(header, claims, build.key ?? who.key.privateKey);
}

async function send(body: string, contentType: string | null = "application/jwt", d = deps()): Promise<Outcome> {
  return handleAction({ contentType, body }, d, decide);
}

function code(outcome: Outcome): string | undefined {
  return (outcome.body as Partial<ActionProblem>).code;
}

describe("valid actions", () => {
  it.each<Act>([
    { verb: "comment", target: TARGET, ref: REF, content: "Could the skate park stay open until 9?", lang: "en" },
    { verb: "support", target: TARGET, ref: REF },
    { verb: "rsvp", target: TARGET, ref: REF, answer: "yes" },
    { verb: "poll_answer", target: TARGET, ref: REF, choices: ["a"] },
    { verb: "withdraw", target: `${TARGET}/s/1`, ref: REF, withdraws: "support" },
  ])("accepts $verb, reaching the space's rules once", async (act) => {
    const outcome = await send(jws({ act }));
    expect(outcome.status).toBe(201);
    expect(decisions).toBe(1);
  });

  it("passes the JWS, its claims and the DID's host to the space's rules", async () => {
    const body = jws();
    let seen: Parameters<Decide>[0] | undefined;
    await handleAction({ contentType: "application/jwt; charset=utf-8", body }, deps(), async (action) => {
      seen = action;
      return answer({ status: "held", id: `${TARGET}/s/1`, withdrawable: true, ref: REF, message: "m".repeat(400) });
    });
    expect(seen?.jws).toBe(body);
    expect(seen?.claims.iss).toBe(member.did);
    expect(seen?.didHost).toBe("id.test.example");
  });

  it("clips a held message to 300 characters", () => {
    const outcome = answer({ status: "held", id: TARGET, withdrawable: true, ref: REF, message: "m".repeat(400) });
    expect(outcome.status).toBe(202);
    expect((outcome.body as { message: string }).message).toHaveLength(300);
  });
});

describe("step 1: malformed", () => {
  it.each([
    ["no content type", () => send(jws(), null)],
    ["a JSON content type", () => send(jws(), "application/json")],
    ["an empty body", () => send("")],
    ["two parts", () => send(jws().split(".").slice(0, 2).join("."))],
    ["a body over 16 KB", () => send(jws({ act: { verb: "comment", target: TARGET, ref: REF, content: "a".repeat(5000) }, claims: { pad: "x".repeat(12_000) } }))],
    ["a header that isn't JSON", () => send(`${Buffer.from("nope").toString("base64url")}.${jws().split(".")[1]}.${jws().split(".")[2]}`)],
    ["a payload that is an array", () => send(rawJws({ alg: "EdDSA", typ: "mosaic-action+jwt", kid: member.kid }, [1], member.key.privateKey))],
    ["a JWS with whitespace", () => send(`${jws()}\n`)],
  ])("refuses %s", async (_label, run) => {
    const outcome = await run();
    expect([outcome.status, code(outcome)]).toEqual([400, "malformed"]);
    expect(resolver.requests).toHaveLength(0);
  });
});

describe("step 2: bad_type", () => {
  it.each([
    ["alg ES256", { alg: "ES256" }],
    ["alg none", { alg: "none" }],
    ["no typ (a sign-in note)", { typ: undefined }],
    ["typ mosaic-signin+jwt", { typ: "mosaic-signin+jwt" }],
    ["typ JWT", { typ: "JWT" }],
    ["crit", { crit: ["exp"] }],
  ])("refuses %s", async (_label, header) => {
    const outcome = await send(jws({ header }));
    expect([outcome.status, code(outcome)]).toEqual([401, "bad_type"]);
  });

  it("refuses a sign-in note sent as an action (check 2)", async () => {
    const note = rawJws(
      { alg: "EdDSA", kid: member.kid },
      { iss: member.did, sub: member.did, aud: "https://river.test.example", nonce: "n".repeat(43), iat: NOW, exp: NOW + 120 },
      member.key.privateKey,
    );
    expect(code(await send(note))).toBe("bad_type");
  });
});

describe("steps 3 and 4: untrusted_did, before any request", () => {
  it.each([
    ["iss and sub differ", (): Build => ({ claims: { sub: authOnly.did } })],
    ["a did:web", (): Build => ({ claims: { iss: "did:web:id.test.example", sub: "did:web:id.test.example" } })],
    ["a kid under another DID's text", (): Build => ({ header: { kid: `${member.did}x#key-1` } })],
    ["a kid with no fragment", (): Build => ({ header: { kid: `${member.did}#` } })],
    ["a kid that is another DID", (): Build => ({ header: { kid: authOnly.kid } })],
  ])("refuses %s", async (_label, build) => {
    const outcome = await send(jws(build()));
    expect([outcome.status, code(outcome)]).toEqual([401, "untrusted_did"]);
    expect(resolver.requests).toHaveLength(0);
  });

  it.each([
    ["evilid.test.example (no dot boundary)", () => evil],
    ["id.test.example.evil.example (the entry as a prefix)", () => suffixed],
  ])("refuses a DID at %s without reading its log", async (_label, who) => {
    const outcome = await send(jws({ who: who() }));
    expect([outcome.status, code(outcome)]).toEqual([401, "untrusted_did"]);
    expect(resolver.requests).toHaveLength(0);
  });

  it("accepts a DID on a subdomain of a did_hosts entry (floyd.id.test.example)", async () => {
    const outcome = await send(jws({ who: floyd }));
    expect(outcome.status).toBe(201);
    expect(resolver.requests).toEqual([floyd.logUrl]);
  });

  it("refuses every DID when did_hosts is empty", async () => {
    const outcome = await send(jws(), "application/jwt", deps({ manifest: { ...MANIFEST, did_hosts: [] } }));
    expect(code(outcome)).toBe("untrusted_did");
  });
});

describe("step 5: wrong_audience (check 2)", () => {
  it.each([
    ["another space's aud", { aud: "did:web:other.test.example" }],
    ["another endpoint", { htu: "https://space.test.example/other" }],
    ["another space's endpoint", { htu: "https://other.test.example/actions" }],
    ["GET", { htm: "GET" }],
    ["no aud", { aud: undefined }],
  ])("refuses %s", async (_label, claims) => {
    const outcome = await send(jws({ claims }));
    expect([outcome.status, code(outcome)]).toEqual([401, "wrong_audience"]);
  });
});

describe("step 6: expired (check 5)", () => {
  it.each([
    ["exp - iat of 301", { iat: NOW, exp: NOW + 301 }],
    ["iat 61 s ahead", { iat: NOW + 61, exp: NOW + 120 }],
    ["exp 61 s past", { iat: NOW - 120, exp: NOW - 61 }],
    ["exp before iat", { iat: NOW, exp: NOW - 1 }],
    ["a fractional iat", { iat: NOW + 0.5 }],
    ["a string exp", { exp: String(NOW + 120) }],
  ])("refuses %s", async (_label, claims) => {
    const outcome = await send(jws({ claims }));
    expect([outcome.status, code(outcome)]).toEqual([401, "expired"]);
  });

  it.each([
    ["iat 59 s ahead", { iat: NOW + 59, exp: NOW + 120 }],
    ["exp 59 s past", { iat: NOW - 120, exp: NOW - 59 }],
    ["exp - iat of 300", { iat: NOW, exp: NOW + 300 }],
  ])("accepts %s", async (_label, claims) => {
    expect((await send(jws({ claims }))).status).toBe(201);
  });
});

describe("step 7: the signature", () => {
  it("refuses a signature by another key", async () => {
    const outcome = await send(jws({ key: seededKey(seed(99)).privateKey }));
    expect([outcome.status, code(outcome)]).toEqual([401, "bad_signature"]);
  });

  it("refuses a key listed only under authentication, and verifies it once assertionMethod lists it (check 3)", async () => {
    const before = await send(jws({ who: authOnly }));
    expect(code(before)).toBe("bad_signature");
    const granted = await makeActionDid({
      host: "id.test.example",
      code: "member02",
      keySeed: seed(3),
      recoverySeed: seed(4),
      created: CREATED,
    });
    expect(granted.did).toBe(authOnly.did);
    resolver.serve(granted);
    // A minute later, the cached document fails and the log is read fresh once.
    const later = NOW + 60;
    const after = await send(
      jws({ who: authOnly, act: { verb: "support", target: TARGET, ref: REF2 }, claims: { iat: later, exp: later + 120 } }),
      "application/jwt",
      deps({ now: () => later }),
    );
    expect(after.status).toBe(201);
  });

  it("refuses an unknown DID (its log is missing) as bad_signature", async () => {
    resolver.logs.delete(member.logUrl);
    expect(code(await send(jws()))).toBe("bad_signature");
  });

  it("answers did_unavailable with Retry-After when the log can't be read just now", async () => {
    resolver.failWith = new DidUnavailableError(30);
    const outcome = await send(jws());
    expect([outcome.status, code(outcome), outcome.retryAfter]).toEqual([503, "did_unavailable", 30]);
  });

  it.each([
    ["a 503", () => (resolver.status = 503)],
    ["a network failure", () => (resolver.failWith = new Error("socket hang up"))],
  ])("answers did_unavailable when the log server gives %s", async (_label, fail) => {
    fail();
    expect(code(await send(jws()))).toBe("did_unavailable");
  });

  it("refuses a deactivated DID", async () => {
    const ended = await makeActionDid({
      host: "id.test.example",
      code: "member06",
      keySeed: seed(11),
      recoverySeed: seed(12),
      created: CREATED,
      deactivated: true,
    });
    resolver.serve(ended);
    expect(code(await send(jws({ who: ended })))).toBe("bad_signature");
  });

  it("refuses another spelling of a real DID's host before any request", async () => {
    for (const variant of [
      member.did.replace(":id.test.example:", ":ID.test.example:"),
      member.did.replace(":id.test.example:", ":Id.Test.Example:"),
    ]) {
      const outcome = await send(jws({ claims: { iss: variant, sub: variant }, header: { kid: `${variant}#key-1` } }));
      expect(code(outcome)).toBe("untrusted_did");
    }
    expect(resolver.requests).toHaveLength(0);
  });

  it("allows a fresh read again a minute later", async () => {
    const forged = (now: number, ref: string) =>
      jws({ key: seededKey(seed(98)).privateKey, act: { verb: "support", target: TARGET, ref }, claims: { iat: now, exp: now + 120 } });
    await send(forged(NOW, REF));
    expect(resolver.requests).toHaveLength(2);
    await send(forged(NOW + 59, REF2), "application/jwt", deps({ now: () => NOW + 59 }));
    expect(resolver.requests).toHaveLength(2);
    await send(forged(NOW + 60, REF2), "application/jwt", deps({ now: () => NOW + 60 }));
    expect(resolver.requests).toHaveLength(3);
  });

  it("reads the log fresh once when a cached document fails, at most once a minute per DID", async () => {
    expect((await send(jws())).status).toBe(201);
    expect(resolver.requests).toHaveLength(1);
    const forged = () => jws({ key: seededKey(seed(98)).privateKey, act: { verb: "support", target: TARGET, ref: REF2 } });
    expect(code(await send(forged()))).toBe("bad_signature");
    expect(resolver.requests).toHaveLength(2);
    expect(code(await send(forged()))).toBe("bad_signature");
    expect(resolver.requests).toHaveLength(2);
  });

  it("ignores a key in the header", async () => {
    const other = seededKey(seed(97));
    const jwk = other.publicKey.export({ format: "jwk" });
    expect(code(await send(jws({ key: other.privateKey, header: { jwk } })))).toBe("bad_signature");
  });
});

describe("step 8: invalid_action", () => {
  it.each([
    ["an extra act field", { act: { verb: "support", target: TARGET, ref: REF, note: "x" } }],
    ["an unknown verb", { act: { verb: "like", target: TARGET, ref: REF } }],
    ["no act", { act: undefined }],
    ["an extra claim", { nonce: "abc" }],
    ["a short jti", { jti: "abc" }],
    ["a client that isn't an https origin", { client: "https://river.test.example/" }],
    ["an http client", { client: "http://river.test.example" }],
    ["another assurance", { assurance: "password" }],
  ])("refuses %s", async (_label, claims) => {
    const outcome = await send(jws({ claims }));
    expect([outcome.status, code(outcome)]).toEqual([400, "invalid_action"]);
    expect(decisions).toBe(0);
  });
});

describe("step 9: idempotency and replay (check 4)", () => {
  it("answers a repeated (iss, ref) with the same act from storage, whatever its jti or assurance", async () => {
    const first = await send(jws());
    const again = await send(jws({ claims: { assurance: "passkey" } }));
    expect(again).toEqual(first);
    expect(decisions).toBe(1);
  });

  it("refuses the same ref with another act as ref_conflict", async () => {
    await send(jws());
    const outcome = await send(jws({ act: { verb: "rsvp", target: TARGET, ref: REF, answer: "no" } }));
    expect([outcome.status, code(outcome)]).toEqual([409, "ref_conflict"]);
  });

  it("refuses a new ref with a used jti as replayed", async () => {
    const jti = "AAAAAAAAAAAAAAAAAAAAAA";
    await send(jws({ claims: { jti } }));
    const outcome = await send(jws({ claims: { jti }, act: { verb: "support", target: TARGET, ref: REF2 } }));
    expect([outcome.status, code(outcome)]).toEqual([409, "replayed"]);
  });

  it("processes the same ref again after a retryable refusal, and stores a final one", async () => {
    let next: Outcome = refusal("rate_limited", { retryAfter: 60 });
    decide = async () => {
      decisions += 1;
      return next;
    };
    expect(code(await send(jws()))).toBe("rate_limited");
    next = refusal("assurance_required");
    expect(code(await send(jws()))).toBe("assurance_required");
    next = refusal("closed");
    expect(code(await send(jws({ claims: { assurance: "passkey" } })))).toBe("closed");
    next = answer({ status: "accepted", id: TARGET, withdrawable: true, ref: REF });
    expect(code(await send(jws()))).toBe("closed");
    expect(decisions).toBe(3);
  });

  it("records one action when a retry arrives while the first request is still answered", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    decide = async (action) => {
      decisions += 1;
      await gate;
      return answer({ status: "accepted", id: `${TARGET}/s/1`, withdrawable: true, ref: action.claims.act.ref });
    };
    const first = send(jws());
    await new Promise((resolve) => setTimeout(resolve, 10));
    const retry = await send(jws({ claims: { jti: "BBBBBBBBBBBBBBBBBBBBBB" } }));
    expect([retry.status, code(retry), retry.retryAfter]).toEqual([503, "unavailable", 5]);
    const conflicting = await send(jws({ act: { verb: "rsvp", target: TARGET, ref: REF, answer: "no" }, claims: { jti: "CCCCCCCCCCCCCCCCCCCCCC" } }));
    expect(code(conflicting)).toBe("ref_conflict");
    release();
    expect((await first).status).toBe(201);
    const after = await send(jws({ claims: { jti: "DDDDDDDDDDDDDDDDDDDDDD" } }));
    expect(after.status).toBe(201);
    expect(decisions).toBe(1);
  });

  it("releases the ref when the space's rules throw", async () => {
    decide = async () => {
      decisions += 1;
      throw new Error("database down");
    };
    await expect(send(jws())).rejects.toThrow("database down");
    decide = async (action) => answer({ status: "accepted", id: TARGET, withdrawable: true, ref: action.claims.act.ref });
    expect((await send(jws({ claims: { jti: "EEEEEEEEEEEEEEEEEEEEEE" } }))).status).toBe(201);
  });

  it("stores the answer under the act as signed, even if the space's rules change the claims", async () => {
    decide = async (action) => {
      decisions += 1;
      (action.claims.act as { target: string }).target = `${TARGET}/normalised`;
      return answer({ status: "accepted", id: TARGET, withdrawable: true, ref: action.claims.act.ref });
    };
    await send(jws());
    const again = await send(jws({ claims: { jti: "FFFFFFFFFFFFFFFFFFFFFF" } }));
    expect(again.status).toBe(201);
    expect(decisions).toBe(1);
  });

  it("forgets a stored answer after 24 hours", async () => {
    await send(jws());
    const later = NOW + 24 * 3600;
    const outcome = await send(jws({ claims: { iat: later, exp: later + 120 } }), "application/jwt", deps({ now: () => later }));
    expect(outcome.status).toBe(201);
    expect(decisions).toBe(2);
  });
});

describe("refusal()", () => {
  it("builds an RFC 9457 problem with the code, clipped detail and join", () => {
    const outcome = refusal("not_member", { detail: "d".repeat(400), join: "https://space.test.example/join" });
    expect(outcome.status).toBe(403);
    expect(outcome.contentType).toBe("application/problem+json");
    expect(outcome.body).toMatchObject({ type: "about:blank", status: 403, code: "not_member", join: "https://space.test.example/join" });
    expect((outcome.body as ActionProblem).detail).toHaveLength(300);
  });
});
