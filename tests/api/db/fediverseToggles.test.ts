// Boost, favourite and follow over HTTP (fediverse-posting-1.md item 4; checks 4, 8, 9, 11, 13,
// 17), against the running dev server with TEST_STAND_IN_FEDIVERSE=1: every request to a member's
// server goes to the SYNTHETIC stand-in. Members sign in through the River's real callback and link
// through the real flow. Fediverse spaces and items are written as the local stack's postgres
// (setup only), as the adapter would store them; acts are read back as postgres.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { linkFediverse } from "../helpers/linkFediverse.js";
import { API, DidLogServer, requireApi, type Member } from "../helpers/member.js";
import { standIn } from "../helpers/standInFediverse.js";
import { ADMIN_URL } from "./roles.js";

const logs = new DidLogServer();
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const REMOTE = "https://remote.example";
const HOST = "mastodon.stand-in.example";
let itemId: string;
let boostId: string;
let sampleItemId: string;
let spaceId: string;
let lockedSpaceId: string;
let missingSpaceId: string;
let otherSpaceId: string;

beforeAll(async () => {
  await requireApi();
  await logs.start();
  const suffix = randomUUID().slice(0, 8);
  const space = async (path: string, name: string, adapter = "fediverse") =>
    (
      await admin.query<{ id: string }>(
        `INSERT INTO river.spaces (adapter, canonical_url, actor_id, home_url, name, network, category)
         VALUES ($1, $2, $2, $3, $4, 'mastodon', 'person') RETURNING id`,
        [adapter, `${REMOTE}/users/${path}-${suffix}`, `${REMOTE}/@${path}-${suffix}`, name],
      )
    ).rows[0]!.id;
  spaceId = await space("poster", "Remote poster (toggles test)");
  lockedSpaceId = await space("locked", "A locked account (toggles test)");
  missingSpaceId = await space("missing", "An account its server can't find (toggles test)");
  otherSpaceId = (await admin.query<{ id: string }>("SELECT id FROM river.spaces WHERE adapter <> 'fediverse' LIMIT 1")).rows[0]?.id ?? randomUUID();
  const post = await admin.query<{ id: string }>(
    `INSERT INTO river.items (space_id, source_id, kind, published_at, content_html, url, author, raw)
     VALUES ($1, $2, 'post', now(), '<p>A post to boost</p>', $3, $4, $5) RETURNING id`,
    [
      spaceId,
      `${REMOTE}/users/poster/statuses/1-${suffix}/activity`,
      `${REMOTE}/@poster/1-${suffix}`,
      JSON.stringify({ name: "Poster", handle: "@poster@remote.example", url: `${REMOTE}/users/poster` }),
      JSON.stringify({ type: "Create", id: `${REMOTE}/users/poster/statuses/1-${suffix}/activity`, object: { id: `${REMOTE}/users/poster/statuses/1-${suffix}`, type: "Note" } }),
    ],
  );
  itemId = post.rows[0]!.id;
  const boost = await admin.query<{ id: string }>(
    `INSERT INTO river.items (space_id, source_id, kind, published_at, content_html, url, boost_of, raw)
     VALUES ($1, $2, 'post', now(), '<p>Boosted</p>', $3, $4, $5) RETURNING id`,
    [
      spaceId,
      `${REMOTE}/users/poster/statuses/2-${suffix}/activity`,
      "https://elsewhere.example/@writer/9",
      JSON.stringify({ objectId: `https://elsewhere.example/users/writer/statuses/9-${suffix}`, host: "elsewhere.example" }),
      JSON.stringify({ type: "Announce", id: `${REMOTE}/users/poster/statuses/2-${suffix}/activity` }),
    ],
  );
  boostId = boost.rows[0]!.id;
  const sample = await admin.query<{ id: string }>(
    "SELECT i.id FROM river.items i JOIN river.spaces s ON s.id = i.space_id WHERE s.adapter <> 'fediverse' LIMIT 1",
  );
  sampleItemId = sample.rows[0]?.id ?? randomUUID();
});

afterAll(async () => {
  await logs.close();
  await admin.end();
});

beforeEach(async () => {
  await standIn.reset();
  await admin.query("DELETE FROM river.oauth_clients WHERE host LIKE '%.stand-in.example'");
});

interface Linked {
  who: Member;
  linkId: string;
}

async function linked(input = `@ana@${HOST}`, username = "ana"): Promise<Linked> {
  const who = await logs.signIn();
  return { who, linkId: await linkFediverse(who, input, username) };
}

function post(path: string, who: Member, body?: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: who.origin, cookie: who.cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

interface Result {
  id: string | null;
  status: string;
  verb: string;
  on: boolean | null;
  requested: boolean;
  error: string | null;
  message: string;
  firstToggle: boolean;
}

async function toggle(l: Linked, verb: string, item = itemId): Promise<{ res: Response; body: Result }> {
  const res = await post("/acts/fediverse/toggle", l.who, { linkedAccountId: l.linkId, itemId: item, verb });
  return { res, body: (await res.json()) as Result };
}

async function follow(l: Linked, verb: string, space = spaceId): Promise<{ res: Response; body: Result }> {
  const res = await post("/acts/fediverse/follow", l.who, { linkedAccountId: l.linkId, spaceId: space, verb });
  return { res, body: (await res.json()) as Result };
}

async function act(id: string): Promise<Record<string, unknown>> {
  const { rows } = await admin.query("SELECT * FROM river.member_actions WHERE id = $1", [id]);
  return rows[0] as Record<string, unknown>;
}

const toggleRequests = async () =>
  (await standIn.requests()).filter((r) => r.method === "POST" && /\/(reblog|unreblog|favourite|unfavourite|follow|unfollow)$/.test(r.path));

describe("boost and favourite", () => {
  it("boost: resolves the post, sends a public reblog with the token, records the act, and the state reads boosted (check 8)", async () => {
    const l = await linked();
    const { res, body } = await toggle(l, "boost");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "sent", verb: "boost", on: true, error: null, firstToggle: true });
    const sent = await toggleRequests();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toMatch(/^\/api\/v1\/statuses\/\d+\/reblog$/);
    expect(sent[0]?.headers.authorization).toMatch(/^Bearer /);
    expect(JSON.parse(sent[0]?.body ?? "{}")).toEqual({ visibility: "public" });
    const row = await act(body.id!);
    expect(row).toMatchObject({ verb: "boost", status: "sent", limit_kind: "toggle", item_id: itemId, target_host: HOST });
    const state = await fetch(`${API}/acts/fediverse/state?linkedAccountId=${l.linkId}&itemId=${itemId}`, { headers: { cookie: l.who.cookie } });
    expect(await state.json()).toEqual({ reblogged: true, favourited: false });
    // The second toggle on this link isn't the first any more.
    expect((await toggle(l, "favourite")).body).toMatchObject({ status: "sent", on: true, firstToggle: false });
  });

  it("unboost undoes the River's boost: unreblog, a new row pointing at it, and the original reads undone (check 8)", async () => {
    const l = await linked();
    const boosted = (await toggle(l, "boost")).body;
    const { body } = await toggle(l, "unboost");
    expect(body).toMatchObject({ status: "sent", verb: "unboost", on: false });
    expect((await toggleRequests()).map((r) => r.path.split("/").pop())).toEqual(["reblog", "unreblog"]);
    expect(await act(body.id!)).toMatchObject({ verb: "unboost", undoes_id: boosted.id, status: "sent" });
    expect(await act(boosted.id!)).toMatchObject({ status: "undone" });
    expect((await standIn.toggles()).reblogs).toEqual([]);
  });

  it("a boost card's toggles act on the boosted post: its URI is what the server searches for (check 4)", async () => {
    const l = await linked();
    expect((await toggle(l, "favourite", boostId)).body.status).toBe("sent");
    const search = (await standIn.requests()).find((r) => r.path.startsWith("/api/v2/search"));
    expect(new URL(search!.path, "https://x").searchParams.get("q")).toMatch(/^https:\/\/elsewhere\.example\/users\/writer\/statuses\/9-/);
  });

  it("refuses items that aren't live fediverse posts, and unknown verbs, sending nothing (check 4's server half)", async () => {
    const l = await linked();
    expect((await toggle(l, "boost", sampleItemId)).res.status).toBe(422);
    expect((await toggle(l, "boost", randomUUID())).res.status).toBe(422);
    expect((await toggle(l, "reply")).res.status).toBe(400);
    expect(await standIn.requests()).not.toContainEqual(expect.objectContaining({ path: expect.stringContaining("/api/v2/search") }));
  });

  it("a refusal at the server is recorded as failed with item 7's message; a 422's text stays text (checks 8, 11)", async () => {
    const l = await linked();
    await standIn.rules([{ path: "/api/v1/statuses/", method: "POST", answer: 422, message: "<b>Nope</b>" }]);
    const { res, body } = await toggle(l, "boost");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "failed", error: "rejected", on: null, message: `${HOST} says: <b>Nope</b>` });
    expect(await act(body.id!)).toMatchObject({ status: "failed", error_code: "rejected", error_message: "<b>Nope</b>" });
    await standIn.rules([{ path: "/api/v1/statuses/", method: "POST", answer: 403 }]);
    expect((await toggle(l, "favourite")).body).toMatchObject({ status: "failed", error: "scope" });
  });

  it("a 401 marks the link revoked and deletes its token; a search that fails writes no act (check 11)", async () => {
    const l = await linked();
    await standIn.rules([{ path: "/api/v2/search", answer: 503 }]);
    const unreachable = await toggle(l, "boost");
    expect(unreachable.res.status).toBe(502);
    const { rows } = await admin.query("SELECT count(*)::int AS n FROM river.member_actions WHERE linked_account_id = $1", [l.linkId]);
    expect(rows[0].n).toBe(0);
    await standIn.rules([]);
    await standIn.revokeAll();
    const revoked = await toggle(l, "boost");
    expect(revoked.res.status).toBe(409);
    expect(revoked.body).toMatchObject({ error: "revoked" });
    const link = await admin.query("SELECT status, token_ciphertext FROM river.linked_accounts WHERE id = $1", [l.linkId]);
    expect(link.rows[0]).toMatchObject({ status: "revoked", token_ciphertext: null });
  });

  it("a 401 on the reblog itself fails the act, revokes the link and deletes its token (check 11)", async () => {
    const l = await linked();
    await standIn.rules([{ path: "/api/v1/statuses/", method: "POST", answer: 401 }]);
    const { body } = await toggle(l, "boost");
    expect(body).toMatchObject({ status: "failed", error: "revoked", message: "Your link to @ana@mastodon.stand-in.example stopped working. Link it again." });
    expect(await act(body.id!)).toMatchObject({ status: "failed", error_code: "revoked" });
    const link = await admin.query("SELECT status, token_ciphertext FROM river.linked_accounts WHERE id = $1", [l.linkId]);
    expect(link.rows[0]).toMatchObject({ status: "revoked", token_ciphertext: null });
  });

  it("after Sign out everywhere, a toggle from the old session is refused and nothing is sent (check 16)", async () => {
    const l = await linked();
    expect((await post("/auth/signout-everywhere", l.who)).status).toBe(204);
    expect((await toggle(l, "boost")).res.status).toBe(401);
    expect(await toggleRequests()).toEqual([]);
  });

  it("a reblog that times out is unknown, not failed: the server may have got it", async () => {
    const l = await linked();
    await standIn.rules([{ path: "/api/v1/statuses/", method: "POST", answer: "slow" }]);
    const { body } = await toggle(l, "boost");
    expect(body).toMatchObject({ status: "unknown", on: null, message: `We couldn't tell whether ${HOST} got it.` });
    expect(await act(body.id!)).toMatchObject({ status: "unknown", error_code: "timeout" });
  }, 20_000);

  it("a reblog that redirects is a failure, and nothing reaches the redirect's target (check 13)", async () => {
    const l = await linked();
    await standIn.rules([{ path: "/api/v1/statuses/", method: "POST", answer: "redirect" }]);
    const { body } = await toggle(l, "boost");
    expect(body.status).toBe("failed");
    expect((await standIn.requests()).filter((r) => r.host === "elsewhere.stand-in.example")).toEqual([]);
  });
});

describe("follow on the server", () => {
  it("follows the space's actor as the linked account, reads following, and doesn't follow the space in the River (check 9)", async () => {
    const l = await linked();
    const before = await admin.query("SELECT count(*)::int AS n FROM river.follows");
    const { res, body } = await follow(l, "follow");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "sent", verb: "follow", on: true, requested: false, message: "Following as @ana@mastodon.stand-in.example" });
    const sent = await toggleRequests();
    expect(sent.map((r) => r.path)).toEqual([expect.stringMatching(/^\/api\/v1\/accounts\/\d+\/follow$/)]);
    expect(await act(body.id!)).toMatchObject({ verb: "follow", limit_kind: "follow", subject_title: "Remote poster (toggles test)" });
    const rel = await fetch(`${API}/acts/fediverse/relationship?linkedAccountId=${l.linkId}&spaceId=${spaceId}`, { headers: { cookie: l.who.cookie } });
    expect(await rel.json()).toEqual({ following: true, requested: false });
    expect((await admin.query("SELECT count(*)::int AS n FROM river.follows")).rows[0].n).toBe(before.rows[0].n);
  });

  it("following a space in the River sends nothing to the member's server (check 9, the other way round)", async () => {
    const l = await linked();
    const before = (await standIn.requests()).length;
    const res = await post("/follows", l.who, { input: "@w3c@w3c.social", circleIds: [] });
    expect(res.status).toBe(201);
    expect((await standIn.requests()).slice(before)).toEqual([]);
  });

  it("a locked account reads Requested; unfollow undoes the follow and marks it undone (check 9)", async () => {
    const l = await linked();
    expect((await follow(l, "follow", lockedSpaceId)).body).toMatchObject({ status: "sent", on: false, requested: true });
    const followed = (await follow(l, "follow")).body;
    const { body } = await follow(l, "unfollow");
    expect(body).toMatchObject({ status: "sent", verb: "unfollow", on: false });
    expect(await act(body.id!)).toMatchObject({ undoes_id: followed.id });
    expect(await act(followed.id!)).toMatchObject({ status: "undone" });
  });

  it("refuses a space that isn't fediverse, and says when the server can't find the account", async () => {
    const l = await linked();
    expect((await follow(l, "follow", otherSpaceId)).res.status).toBe(422);
    const missing = await follow(l, "follow", missingSpaceId);
    expect(missing.res.status).toBe(422);
    expect(missing.body.message).toBe(`${HOST} couldn't find this account.`);
    expect(await toggleRequests()).toEqual([]);
  });
});

describe("undo from Your activity", () => {
  it("undoes a boost, a favourite and a follow by the same server-local id, with no new search", async () => {
    const l = await linked();
    const boosted = (await toggle(l, "boost")).body;
    const faved = (await toggle(l, "favourite")).body;
    const followed = (await follow(l, "follow")).body;
    const before = (await standIn.requests()).length;
    for (const original of [boosted, faved, followed]) {
      const res = await post(`/acts/${original.id}/undo`, l.who);
      expect(res.status).toBe(200);
      expect(((await res.json()) as Result).status).toBe("sent");
      expect(await act(original.id!)).toMatchObject({ status: "undone" });
    }
    const paths = (await standIn.requests()).slice(before).map((r) => r.path);
    // None of the undos searched again.
    expect(paths.some((p) => p.startsWith("/api/v2/search"))).toBe(false);
    expect(paths.map((p) => p.split("/").pop())).toEqual(["unreblog", "unfavourite", "unfollow"]);
  });

  it("refuses to undo a post, an undone act or another member's act", async () => {
    const l = await linked();
    const other = await linked("@bob@mastodon.stand-in.example", "bob");
    const boosted = (await toggle(l, "boost")).body;
    expect((await post(`/acts/${boosted.id}/undo`, other.who)).status).toBe(400);
    await post(`/acts/${boosted.id}/undo`, l.who);
    expect((await post(`/acts/${boosted.id}/undo`, l.who)).status).toBe(400);
    expect((await post(`/acts/${randomUUID()}/undo`, l.who)).status).toBe(400);
  });
});

describe("who may toggle", () => {
  it("visitors get 401, and nothing in an answer carries a token (check 17)", async () => {
    const res = await fetch(`${API}/acts/fediverse/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:4173" },
      body: JSON.stringify({ itemId, verb: "boost" }),
    });
    expect(res.status).toBe(401);
    const l = await linked();
    const answers = [
      JSON.stringify((await toggle(l, "boost")).body),
      JSON.stringify((await follow(l, "follow")).body),
      await (await fetch(`${API}/acts/fediverse/state?linkedAccountId=${l.linkId}&itemId=${itemId}`, { headers: { cookie: l.who.cookie } })).text(),
    ];
    for (const token of await standIn.tokens()) for (const a of answers) expect(a.includes(token)).toBe(false);
  });

  it("another member's link can't be used", async () => {
    const l = await linked();
    const other = await logs.signIn();
    const res = await post("/acts/fediverse/toggle", other, { linkedAccountId: l.linkId, itemId, verb: "boost" });
    expect(res.status).toBe(409);
    expect(await toggleRequests()).toEqual([]);
  });
});
