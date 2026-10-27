// The stand-in space (space-actions-1 section 8; tests/support/standInSpace/): the conformance
// suite through its HTTP handler, its manifest and feed, its own rules (steps 10 to 13) and its
// switches for not_member, held and rate_limited. Requests are signed with the vectors' test keys.
import { beforeEach, describe, expect, it } from "vitest";
import {
  actionClaims,
  readManifestActions,
  signAction,
  type Act,
  type ActionProblem,
  type Assurance,
} from "../../src/shared/spaceActions/index.js";
import { loadVectors, runSuite, type Target, type VectorDid } from "../conformance/space-actions/suite.js";
import {
  STAND_IN_AUDIENCE,
  STAND_IN_ENDPOINT,
  STAND_IN_ITEMS,
  STAND_IN_JOIN,
  STAND_IN_ORIGIN,
  StandInSpace,
} from "../support/standInSpace/index.js";
import { MapDidResolver, seededKey } from "../support/spaceActions/testDid.js";

const vectors = loadVectors();
const NOW = vectors.now;
const member = vectors.dids[0]!;
const other = vectors.dids[2]!;
const PROPOSAL = `${STAND_IN_ORIGIN}/proposals/prop_1`;
const EVENT = `${STAND_IN_ORIGIN}/events/evt_1`;
const POLL = `${STAND_IN_ORIGIN}/polls/poll_1`;
const PASSKEY_POLL = `${STAND_IN_ORIGIN}/polls/poll_2`;
const CLOSED = `${STAND_IN_ORIGIN}/proposals/prop_2`;
const FINAL_EVENT = `${STAND_IN_ORIGIN}/events/evt_2`;
const MULTI_POLL = `${STAND_IN_ORIGIN}/polls/poll_3`;

let space: StandInSpace;
let resolver: MapDidResolver;
let counter = 0;

beforeEach(() => {
  resolver = new MapDidResolver(() => NOW * 1000);
  for (const did of vectors.dids) resolver.logs.set(did.log_url, did.log);
  space = new StandInSpace({ resolver, now: () => NOW });
});

function ref(): string {
  counter += 1;
  return `10000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

async function signed(act: Act, who: VectorDid = member, assurance: Assurance = "grant"): Promise<string> {
  const claims = actionClaims({
    did: who.did,
    aud: STAND_IN_AUDIENCE,
    htu: STAND_IN_ENDPOINT,
    client: "https://river.test.example",
    assurance,
    act,
    now: NOW,
  });
  const key = seededKey(who.key_seed);
  return signAction(who.kid, claims, key.sign);
}

async function post(body: string, contentType = "application/jwt"): Promise<{ status: number; headers: Headers; body: Record<string, unknown> }> {
  const res = await space.handle(new Request(STAND_IN_ENDPOINT, { method: "POST", headers: { "content-type": contentType }, body }));
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, unknown> };
}

async function act(a: Act, who?: VectorDid, assurance?: Assurance) {
  return post(await signed(a, who, assurance));
}

describe("conformance", () => {
  it("passes every vector through its HTTP handler", async () => {
    const target: Target = {
      async send({ contentType, body }) {
        const res = await space.handle(new Request(STAND_IN_ENDPOINT, { method: "POST", headers: { "content-type": contentType }, body }));
        return { status: res.status, body: await res.json() };
      },
      didRequests: () => resolver.requests.length,
    };
    const failures = (await runSuite(target, vectors)).filter((r) => !r.ok);
    expect(failures).toEqual([]);
  });
});

describe("manifest and feed", () => {
  it("serves a manifest whose actions block a client accepts", async () => {
    const res = await space.handle(new Request(`${STAND_IN_ORIGIN}/.well-known/civic.json`));
    const manifest = await res.json();
    expect(readManifestActions(manifest, `${STAND_IN_ORIGIN}/.well-known/civic.json`)).toMatchObject({
      endpoint: STAND_IN_ENDPOINT,
      audience: STAND_IN_AUDIENCE,
      did_hosts: ["id.test.example"],
      join: STAND_IN_JOIN,
    });
  });

  it("serves a feed with civic:actions on a proposal, an event, a poll and a passkey poll", async () => {
    const res = await space.handle(new Request(`${STAND_IN_ORIGIN}/events?page=true&limit=50`));
    const feed = (await res.json()) as { orderedItems: Array<{ object: { id: string }; "civic:actions": Array<Record<string, unknown>> }> };
    const byObject = new Map(feed.orderedItems.map((a) => [a.object.id, a["civic:actions"]]));
    expect(byObject.get(PROPOSAL)?.map((a) => a.verb)).toEqual(["comment", "support"]);
    expect(byObject.get(EVENT)?.map((a) => a.verb)).toEqual(["rsvp"]);
    expect(byObject.get(POLL)?.map((a) => a.verb)).toEqual(["poll_answer"]);
    expect(byObject.get(PASSKEY_POLL)?.[0]?.assurance).toBe("passkey");
    expect(byObject.get(CLOSED)?.[0]?.closes_at).toBe("2026-10-01T00:00:00Z");
  });

  it("answers 404 elsewhere and 405 for GET /actions", async () => {
    expect((await space.handle(new Request(`${STAND_IN_ORIGIN}/nothing`))).status).toBe(404);
    expect((await space.handle(new Request(STAND_IN_ENDPOINT))).status).toBe(405);
  });
});

describe("its own rules (steps 10 to 13)", () => {
  it("keeps the JWS of an accepted comment and links it", async () => {
    const r = ref();
    const body = await signed({ verb: "comment", target: PROPOSAL, ref: r, content: "Yes please." });
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "accepted", id: `${STAND_IN_ORIGIN}/actions/${r}`, url: `${PROPOSAL}#${r}`, withdrawable: true, ref: r });
    expect(space.actions.get(`${STAND_IN_ORIGIN}/actions/${r}`)?.jws).toBe(body);
  });

  it.each([
    ["an unknown target", (): Act => ({ verb: "support", target: `${STAND_IN_ORIGIN}/proposals/nope`, ref: ref() }), 404, "unknown_target"],
    ["a target on another host", (): Act => ({ verb: "support", target: "https://other.example/proposals/prop_1", ref: ref() }), 404, "unknown_target"],
    ["a verb the target doesn't accept", (): Act => ({ verb: "rsvp", target: PROPOSAL, ref: ref(), answer: "yes" }), 422, "not_accepted"],
    ["a closed support", (): Act => ({ verb: "support", target: CLOSED, ref: ref() }), 410, "closed"],
    ["a comment over the target's max_length (500)", (): Act => ({ verb: "comment", target: PROPOSAL, ref: ref(), content: "a".repeat(501) }), 413, "too_long"],
    ["an RSVP answer the event doesn't offer", (): Act => ({ verb: "rsvp", target: FINAL_EVENT, ref: ref(), answer: "maybe" }), 422, "not_accepted"],
    ["a choice the poll doesn't list", (): Act => ({ verb: "poll_answer", target: POLL, ref: ref(), choices: ["z"] }), 422, "not_accepted"],
    ["two choices on a single-choice poll", (): Act => ({ verb: "poll_answer", target: POLL, ref: ref(), choices: ["a", "b"] }), 422, "not_accepted"],
    ["a passkey poll answered under a grant", (): Act => ({ verb: "poll_answer", target: PASSKEY_POLL, ref: ref(), choices: ["yes"] }), 403, "assurance_required"],
  ])("refuses %s", async (_label, make, status, code) => {
    const res = await act(make());
    expect([res.status, res.body.code]).toEqual([status, code]);
  });

  it("accepts the passkey poll with assurance passkey, after assurance_required for the same ref", async () => {
    const a: Act = { verb: "poll_answer", target: PASSKEY_POLL, ref: ref(), choices: ["no"] };
    expect((await act(a)).body.code).toBe("assurance_required");
    const res = await act(a, member, "passkey");
    expect(res.status).toBe(201);
    expect(res.body.withdrawable).toBe(false);
  });

  it("withdraws a support by its id, only once, only by its DID, and never a poll answer", async () => {
    const support = await act({ verb: "support", target: PROPOSAL, ref: ref() });
    const id = String(support.body.id);
    expect((await act({ verb: "withdraw", target: id, ref: ref(), withdraws: "support" }, other)).body.code).toBe("unknown_target");
    expect((await act({ verb: "withdraw", target: id, ref: ref(), withdraws: "comment" })).body.code).toBe("not_accepted");
    const withdrawn = await act({ verb: "withdraw", target: id, ref: ref(), withdraws: "support" });
    expect([withdrawn.status, withdrawn.body.id]).toEqual([201, id]);
    expect(space.actions.get(id)?.withdrawn).toBe(true);
    expect((await act({ verb: "withdraw", target: id, ref: ref(), withdraws: "support" })).body.code).toBe("unknown_target");

    const answered = await act({ verb: "poll_answer", target: POLL, ref: ref(), choices: ["c"] });
    expect((await act({ verb: "withdraw", target: String(answered.body.id), ref: ref(), withdraws: "poll_answer" })).body.code).toBe(
      "not_withdrawable",
    );
  });

  it("reads each entry's own limits: max_length, multiple", async () => {
    expect((await act({ verb: "comment", target: PROPOSAL, ref: ref(), content: "a".repeat(500) })).status).toBe(201);
    expect((await act({ verb: "poll_answer", target: MULTI_POLL, ref: ref(), choices: ["picnic", "walk"] })).status).toBe(201);
  });

  it("replaces an earlier RSVP (changeable by default), and the earlier one can't be withdrawn", async () => {
    const first = await act({ verb: "rsvp", target: EVENT, ref: ref(), answer: "yes" });
    const second = await act({ verb: "rsvp", target: EVENT, ref: ref(), answer: "no" });
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(space.actions.get(String(first.body.id))?.replaced).toBe(true);
    expect((await act({ verb: "withdraw", target: String(first.body.id), ref: ref(), withdraws: "rsvp" })).body.code).toBe("unknown_target");
    expect((await act({ verb: "withdraw", target: String(second.body.id), ref: ref(), withdraws: "rsvp" })).status).toBe(201);
  });

  it("refuses a second answer where the entry isn't changeable (polls by default, and changeable: false)", async () => {
    expect((await act({ verb: "poll_answer", target: POLL, ref: ref(), choices: ["a"] })).status).toBe(201);
    expect((await act({ verb: "poll_answer", target: POLL, ref: ref(), choices: ["b"] })).body.code).toBe("not_accepted");
    const rsvp = await act({ verb: "rsvp", target: FINAL_EVENT, ref: ref(), answer: "yes" });
    expect(rsvp.body.withdrawable).toBe(false);
    expect((await act({ verb: "rsvp", target: FINAL_EVENT, ref: ref(), answer: "no" })).body.code).toBe("not_accepted");
    expect((await act({ verb: "withdraw", target: String(rsvp.body.id), ref: ref(), withdraws: "rsvp" })).body.code).toBe(
      "not_withdrawable",
    );
  });

  it("replaces an earlier answer to a poll marked changeable", async () => {
    const first = await act({ verb: "poll_answer", target: MULTI_POLL, ref: ref(), choices: ["picnic"] });
    const second = await act({ verb: "poll_answer", target: MULTI_POLL, ref: ref(), choices: ["quiz", "walk"] });
    expect(second.status).toBe(201);
    expect(space.actions.get(String(first.body.id))?.replaced).toBe(true);
  });

  it("keeps its items frozen, so no test can put per-person state in the feed", () => {
    expect(Object.isFrozen(STAND_IN_ITEMS)).toBe(true);
    expect(Object.isFrozen(STAND_IN_ITEMS[0]!.actions[0])).toBe(true);
  });

  it("refuses a blocked DID or client", async () => {
    space.blocked.add(member.did);
    expect((await act({ verb: "support", target: PROPOSAL, ref: ref() })).body.code).toBe("blocked");
    space.blocked.clear();
    space.blocked.add("https://river.test.example");
    expect((await act({ verb: "support", target: PROPOSAL, ref: ref() })).body.code).toBe("blocked");
  });
});

describe("switches", () => {
  it("not_member names the join page, and isn't stored: the same ref succeeds after joining", async () => {
    space.switches.notMember = true;
    const a: Act = { verb: "support", target: PROPOSAL, ref: ref() };
    const refused = await act(a);
    expect(refused.status).toBe(403);
    expect(refused.headers.get("content-type")).toBe("application/problem+json");
    expect(refused.body as unknown as ActionProblem).toMatchObject({ code: "not_member", join: STAND_IN_JOIN });
    space.switches.notMember = false;
    expect((await act(a)).status).toBe(201);
  });

  it("held answers 202 with the space's message and records the action as held", async () => {
    space.switches.held = true;
    const r = ref();
    const res = await act({ verb: "comment", target: PROPOSAL, ref: r, content: "Please review me." });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "held", message: "A moderator will look at this soon." });
    expect(space.actions.get(`${STAND_IN_ORIGIN}/actions/${r}`)?.status).toBe("held");
  });

  it("rate_limited sets Retry-After, and the same ref is processed again after the wait", async () => {
    space.switches.rateLimited = true;
    const a: Act = { verb: "rsvp", target: EVENT, ref: ref(), answer: "maybe" };
    const limited = await act(a);
    expect([limited.status, limited.body.code, limited.headers.get("retry-after")]).toEqual([429, "rate_limited", "60"]);
    space.switches.rateLimited = false;
    expect((await act(a)).status).toBe(201);
    expect(space.posts.map((p) => p.status)).toEqual([429, 201]);
  });
});
