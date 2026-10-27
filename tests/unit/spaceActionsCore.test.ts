// Mosaic Space Actions 0.1 reference code, without the verifier (space-actions-1 2.1, 3.2 to 3.4;
// src/shared/spaceActions/): the `act` schema, the manifest's `actions` block and the JWS builder.
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ACTION_TYP,
  FINAL_REFUSALS,
  REFUSALS,
  actionClaims,
  actionKid,
  characterCount,
  checkAct,
  newJti,
  readManifestActions,
  signAction,
} from "../../src/shared/spaceActions/index.js";

const TARGET = "https://demosville.civic.social/process/proc_4";
const REF = "8f1c2b7e-0d4a-4c1e-9a55-1f3b2c6d7e80";

describe("checkAct", () => {
  it.each([
    { verb: "comment", target: TARGET, ref: REF, content: "Could the skate park stay open until 9?", lang: "en" },
    { verb: "comment", target: TARGET, ref: REF, content: "x < y, and 2 > 1" },
    { verb: "comment", target: TARGET, ref: REF, content: "é".repeat(5000) },
    { verb: "support", target: TARGET, ref: REF },
    { verb: "withdraw", target: `${TARGET}#cmt_552`, ref: REF, withdraws: "comment" },
    { verb: "rsvp", target: TARGET, ref: REF, answer: "maybe" },
    { verb: "poll_answer", target: TARGET, ref: REF, choices: ["a"] },
    { verb: "poll_answer", target: TARGET, ref: REF, choices: ["a", "b_2"] },
    { verb: "withdraw", target: "https://demosville.civic.social/comments/cmt_552", ref: REF, withdraws: "comment" },
  ])("accepts $verb %#", (act) => {
    const result = checkAct(act);
    expect(result).toEqual({ ok: true, act });
  });

  it.each([
    ["not an object", "comment"],
    ["an array", [1]],
    ["unknown verb", { verb: "like", target: TARGET, ref: REF }],
    ["an extra field", { verb: "support", target: TARGET, ref: REF, note: "hi" }],
    ["lang on support", { verb: "support", target: TARGET, ref: REF, lang: "en" }],
    ["no ref", { verb: "support", target: TARGET }],
    ["an uppercase ref", { verb: "support", target: TARGET, ref: REF.toUpperCase() }],
    ["a ref that isn't a UUID", { verb: "support", target: TARGET, ref: "abc" }],
    ["an http target", { verb: "support", target: "http://demosville.civic.social/x", ref: REF }],
    ["a target with credentials", { verb: "support", target: "https://u:p@demosville.civic.social/x", ref: REF }],
    ["empty content", { verb: "comment", target: TARGET, ref: REF, content: "  \n " }],
    ["content over 5,000", { verb: "comment", target: TARGET, ref: REF, content: "a".repeat(5001) }],
    ["HTML content", { verb: "comment", target: TARGET, ref: REF, content: "<b>hi</b>" }],
    ["an HTML comment", { verb: "comment", target: TARGET, ref: REF, content: "hi <!-- x -->" }],
    ["control characters", { verb: "comment", target: TARGET, ref: REF, content: "hi\u0000" }],
    ["a bad lang", { verb: "comment", target: TARGET, ref: REF, content: "hi", lang: "en_US" }],
    ["no answer", { verb: "rsvp", target: TARGET, ref: REF }],
    ["another answer", { verb: "rsvp", target: TARGET, ref: REF, answer: "YES" }],
    ["no choices", { verb: "poll_answer", target: TARGET, ref: REF, choices: [] }],
    ["21 choices", { verb: "poll_answer", target: TARGET, ref: REF, choices: Array.from({ length: 21 }, (_, i) => `c${i}`) }],
    ["a repeated choice", { verb: "poll_answer", target: TARGET, ref: REF, choices: ["a", "a"] }],
    ["a choice that isn't an id", { verb: "poll_answer", target: TARGET, ref: REF, choices: ["a b"] }],
    ["withdraw of withdraw", { verb: "withdraw", target: TARGET, ref: REF, withdraws: "withdraw" }],
  ])("refuses %s", (_label, act) => {
    expect(checkAct(act).ok).toBe(false);
  });

  it("counts characters as code points", () => {
    expect(characterCount("a😀b")).toBe(3);
    expect(checkAct({ verb: "comment", target: TARGET, ref: REF, content: "😀".repeat(5000) }).ok).toBe(true);
  });
});

describe("readManifestActions", () => {
  const URL = "https://demosville.civic.social/.well-known/civic.json";
  const manifest = (actions: Record<string, unknown>, space: unknown = { id: "did:web:demosville.civic.social" }) => ({
    space,
    actions: {
      protocol: "mosaic-space-actions/0.1",
      endpoint: "https://demosville.civic.social/actions",
      audience: "did:web:demosville.civic.social",
      did_hosts: ["id.mosaic.social"],
      verbs: ["comment", "support", "rsvp", "poll_answer"],
      join: "https://demosville.civic.social/join?with=mosaic-id",
      terms: "https://demosville.civic.social/terms",
      ...actions,
    },
  });

  it("reads the spec's example", () => {
    expect(readManifestActions(manifest({}), URL)).toEqual(manifest({}).actions);
  });

  it("drops unknown verbs, bad hosts and non-https links, and keeps the rest", () => {
    const read = readManifestActions(
      manifest({ verbs: ["comment", "dance", "comment"], did_hosts: ["ID.Mosaic.Social", "*.evil.example"], join: "http://x" }),
      URL,
    );
    expect(read?.verbs).toEqual(["comment"]);
    expect(read?.did_hosts).toEqual(["id.mosaic.social"]);
    expect(read?.join).toBeUndefined();
  });

  it("uses the origin as the audience when the space has no id", () => {
    expect(readManifestActions(manifest({ audience: "https://demosville.civic.social" }, {}), URL)?.audience).toBe(
      "https://demosville.civic.social",
    );
  });

  it.each([
    ["another protocol", { protocol: "mosaic-space-actions/0.2" }],
    ["an endpoint on another host", { endpoint: "https://evil.example/actions" }],
    ["an endpoint on a subdomain", { endpoint: "https://x.demosville.civic.social/actions" }],
    ["an http endpoint", { endpoint: "http://demosville.civic.social/actions" }],
    ["an endpoint with a fragment", { endpoint: "https://demosville.civic.social/actions#x" }],
    ["the wrong audience", { audience: "did:web:other.civic.social" }],
  ])("ignores a block with %s", (_label, change) => {
    expect(readManifestActions(manifest(change), URL)).toBeUndefined();
  });

  it("ignores a manifest read over http and one with no block", () => {
    expect(readManifestActions(manifest({}), "http://demosville.civic.social/.well-known/civic.json")).toBeUndefined();
    expect(readManifestActions({ space: {} }, URL)).toBeUndefined();
  });
});

describe("the JWS builder", () => {
  const did = "did:webvh:QmTestScidTestScidTest:id.mosaic.social:u:k7q2m9h3";
  const act = { verb: "support" as const, target: TARGET, ref: REF };
  const input = {
    did,
    aud: "did:web:demosville.civic.social",
    htu: "https://demosville.civic.social/actions",
    client: "https://river.mosaic.social",
    assurance: "grant" as const,
    act,
    now: 1_793_050_000,
  };

  it("builds the claims of 3.3 with a 120 s lifetime and a 16-byte jti", () => {
    const claims = actionClaims(input);
    expect(Object.keys(claims)).toEqual(["iss", "sub", "aud", "htm", "htu", "iat", "exp", "jti", "client", "assurance", "act"]);
    expect(claims).toMatchObject({ iss: did, sub: did, htm: "POST", iat: 1_793_050_000, exp: 1_793_050_120 });
    expect(Buffer.from(claims.jti, "base64url")).toHaveLength(16);
    expect(newJti()).not.toBe(newJti());
  });

  it("refuses an invalid act or a lifetime over 300 s", () => {
    expect(() => actionClaims({ ...input, act: { ...act, extra: 1 } as never })).toThrow(/act/);
    expect(() => actionClaims({ ...input, lifetime: 301 })).toThrow(/lifetime/);
  });

  it("signs a compact JWS whose header is alg, typ and kid, and which verifies", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const claims = actionClaims(input);
    const jws = await signAction(actionKid(did), claims, async (data) => sign(null, data, privateKey));
    const [h, p, s] = jws.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "EdDSA", typ: ACTION_TYP, kid: `${did}#key-1` });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual(claims);
    expect(verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("refuses a kid that isn't under the DID", async () => {
    const claims = actionClaims(input);
    const never = async () => new Uint8Array(64);
    await expect(signAction(`${did}x#key-1`, claims, never)).rejects.toThrow(/kid/);
    await expect(signAction(`${did}#`, claims, never)).rejects.toThrow(/kid/);
  });
});

describe("refusal codes", () => {
  it("has every code of 3.5 with its status", () => {
    expect(REFUSALS).toEqual({
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
    });
  });

  it("stores exactly the final refusals of 3.6", () => {
    expect([...FINAL_REFUSALS].sort()).toEqual(
      ["blocked", "closed", "not_accepted", "not_eligible", "not_withdrawable", "too_long", "unknown_target"],
    );
  });
});
