// Posts and replies over HTTP (fediverse-posting-1.md items 3 and 7; checks 5, 11, 12, 13, 15, 16,
// 17), against the running dev server with TEST_STAND_IN_FEDIVERSE=1: every request to a member's
// server goes to the SYNTHETIC stand-in. Members sign in through the River's real callback and link
// through the real flow. A fediverse space and its items are written as the local stack's postgres
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
let itemId: string;
let boostId: string;
let sampleItemId: string;

beforeAll(async () => {
  await requireApi();
  await logs.start();
  const suffix = randomUUID().slice(0, 8);
  const space = await admin.query<{ id: string }>(
    `INSERT INTO river.spaces (adapter, canonical_url, name, network, category)
     VALUES ('fediverse', $1, 'Remote poster (posts test)', 'mastodon', 'person') RETURNING id`,
    [`${REMOTE}/users/poster-${suffix}`],
  );
  const spaceId = space.rows[0]!.id;
  const post = await admin.query<{ id: string }>(
    `INSERT INTO river.items (space_id, source_id, kind, published_at, summary, content_html, url, author, raw)
     VALUES ($1, $2, 'post', now(), 'Spoilers ahead', '<p>The <b>original</b> post</p>', $3, $4, $5) RETURNING id`,
    [
      spaceId,
      `${REMOTE}/users/poster/statuses/1/activity`,
      `${REMOTE}/@poster/1`,
      JSON.stringify({ name: "Poster", handle: "@poster@remote.example", url: `${REMOTE}/users/poster` }),
      JSON.stringify({ type: "Create", id: `${REMOTE}/users/poster/statuses/1/activity`, object: { id: `${REMOTE}/users/poster/statuses/1`, type: "Note" } }),
    ],
  );
  itemId = post.rows[0]!.id;
  const boost = await admin.query<{ id: string }>(
    `INSERT INTO river.items (space_id, source_id, kind, published_at, content_html, url, boost_of, raw)
     VALUES ($1, $2, 'post', now(), '<p>Boosted</p>', $3, $4, $5) RETURNING id`,
    [
      spaceId,
      `${REMOTE}/users/poster/statuses/2/activity`,
      "https://elsewhere.example/@writer/9",
      JSON.stringify({ objectId: "https://elsewhere.example/users/writer/statuses/9", host: "elsewhere.example" }),
      JSON.stringify({ type: "Announce", id: `${REMOTE}/users/poster/statuses/2/activity` }),
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

async function linked(input = "@ana@mastodon.stand-in.example", username = "ana"): Promise<Linked> {
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

async function preview(l: Linked, fields: Record<string, unknown>): Promise<Response> {
  return post("/acts/fediverse/preview", l.who, { linkedAccountId: l.linkId, visibility: "public", ...fields });
}

async function act(id: string): Promise<Record<string, unknown>> {
  const { rows } = await admin.query("SELECT * FROM river.member_actions WHERE id = $1", [id]);
  return rows[0] as Record<string, unknown>;
}

const statusRequests = async () => (await standIn.requests()).filter((r) => r.method === "POST" && r.path === "/api/v1/statuses");

describe("compose", () => {
  it("lists the member's links with defaults and the server's limit, and carries a reply's warning", async () => {
    const l = await linked();
    const res = await fetch(`${API}/acts/fediverse/compose?replyTo=${itemId}`, { headers: { cookie: l.who.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: Array<Record<string, unknown>>; replyTo: Record<string, unknown> };
    expect(body.accounts).toEqual([
      {
        id: l.linkId,
        handle: "@ana@mastodon.stand-in.example",
        server: "mastodon.stand-in.example",
        software: "mastodon",
        defaultVisibility: "unlisted",
        defaultLanguage: "en",
        limits: { maxCharacters: 500, charactersReservedPerUrl: 23 },
      },
    ]);
    expect(body.replyTo).toMatchObject({ itemId, spoilerText: "Spoilers ahead", mention: "@poster@remote.example", url: `${REMOTE}/@poster/1` });
    // No token anywhere in the answer.
    for (const token of await standIn.tokens()) expect(JSON.stringify(body).includes(token)).toBe(false);
  });

  it("GoToSocial's limit is 5,000 (check 6)", async () => {
    const l = await linked("@bob@gts.stand-in.example", "bob");
    const body = (await (await fetch(`${API}/acts/fediverse/compose`, { headers: { cookie: l.who.cookie } })).json()) as {
      accounts: Array<{ limits: { maxCharacters: number } }>;
    };
    expect(body.accounts[0]?.limits.maxCharacters).toBe(5000);
  });

  it("refuses to reply to a non-fediverse item (check 4's server half)", async () => {
    const l = await linked();
    const res = await fetch(`${API}/acts/fediverse/compose?replyTo=${sampleItemId}`, { headers: { cookie: l.who.cookie } });
    expect(res.status).toBe(422);
  });
});

describe("preview and send", () => {
  it("a reply: resolves the post on the member's server, previews the exact request, sends it once with an Idempotency-Key (check 5)", async () => {
    const l = await linked();
    const res = await preview(l, { text: "@poster@remote.example Agreed!", spoilerText: "Spoilers ahead", visibility: "unlisted", language: "en", replyToItemId: itemId });
    expect(res.status).toBe(200);
    const view = (await res.json()) as { id: string; verb: string; as: string; request: { url: string; body: Record<string, string> }; replyTo: { title: string } };
    expect(view.verb).toBe("reply");
    expect(view.as).toBe("@ana@mastodon.stand-in.example");
    const search = (await standIn.requests()).find((r) => r.path.startsWith("/api/v2/search"));
    expect(new URL(search?.path ?? "/", "https://x").searchParams.get("q")).toBe(`${REMOTE}/users/poster/statuses/1`);
    expect(view.request).toEqual({
      method: "POST",
      url: "https://mastodon.stand-in.example/api/v1/statuses",
      body: {
        status: "@poster@remote.example Agreed!",
        visibility: "unlisted",
        spoiler_text: "Spoilers ahead",
        in_reply_to_id: view.request.body.in_reply_to_id,
        language: "en",
      },
    });
    expect(await statusRequests()).toHaveLength(0);
    expect(await act(view.id)).toMatchObject({ status: "previewed", verb: "reply", item_id: itemId });

    const sent = await post(`/acts/${view.id}/send`, l.who);
    expect(sent.status).toBe(200);
    const result = (await sent.json()) as { status: string; remoteUrl: string; message: string };
    expect(result.status).toBe("sent");
    expect(result.message).toBe("Posted on mastodon.stand-in.example");
    const [request] = await statusRequests();
    expect(JSON.parse(request?.body ?? "{}")).toEqual(view.request.body);
    expect(request?.headers["idempotency-key"]).toBe(view.id);
    expect(request?.headers.authorization).toMatch(/^Bearer /);
    const row = await act(view.id);
    expect(row).toMatchObject({ status: "sent", remote_url: result.remoteUrl });
    expect(String(row.remote_url)).toMatch(/^https:\/\/mastodon\.stand-in\.example\/@ana\/\d+$/);
    // Sending the same preview again sends nothing.
    expect((await post(`/acts/${view.id}/send`, l.who)).status).toBe(409);
    expect(await statusRequests()).toHaveLength(1);
  });

  it("a boost card's reply targets the boosted post (check 4)", async () => {
    const l = await linked();
    expect((await preview(l, { text: "Nice", replyToItemId: boostId })).status).toBe(200);
    const search = (await standIn.requests()).find((r) => r.path.startsWith("/api/v2/search"));
    expect(new URL(search?.path ?? "/", "https://x").searchParams.get("q")).toBe("https://elsewhere.example/users/writer/statuses/9");
  });

  it("a post the server can't find is refused at preview, and nothing is stored", async () => {
    const l = await linked();
    await admin.query("UPDATE river.items SET boost_of = jsonb_set(boost_of, '{objectId}', '\"https://elsewhere.example/missing/1\"') WHERE id = $1", [boostId]);
    try {
      const res = await preview(l, { text: "Hello", replyToItemId: boostId });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { message: string }).message).toBe("mastodon.stand-in.example couldn't find this post.");
      const { rows } = await admin.query("SELECT 1 FROM river.member_actions m JOIN river.linked_accounts l ON l.id = m.linked_account_id WHERE l.id = $1", [l.linkId]);
      expect(rows).toHaveLength(0);
    } finally {
      await admin.query("UPDATE river.items SET boost_of = jsonb_set(boost_of, '{objectId}', '\"https://elsewhere.example/users/writer/statuses/9\"') WHERE id = $1", [boostId]);
    }
  });

  it("a 422 shows the server's words as text, a 403 the scope sentence (check 11)", async () => {
    const l = await linked();
    await standIn.rules([{ path: "/api/v1/statuses", answer: 422, message: "<b>Text</b> is too long" }]);
    const first = (await (await preview(l, { text: "Too long" })).json()) as { id: string };
    const failed = (await (await post(`/acts/${first.id}/send`, l.who)).json()) as { status: string; message: string; error: string };
    expect(failed).toMatchObject({ status: "failed", error: "rejected", message: "mastodon.stand-in.example says: <b>Text</b> is too long" });
    expect(await act(first.id)).toMatchObject({ status: "failed", error_code: "rejected", error_message: "<b>Text</b> is too long" });

    await standIn.rules([{ path: "/api/v1/statuses", answer: 403 }]);
    const second = (await (await preview(l, { text: "Hi" })).json()) as { id: string };
    expect(await (await post(`/acts/${second.id}/send`, l.who)).json()).toMatchObject({
      status: "failed",
      message: "mastodon.stand-in.example didn't allow this. Link the account again to allow it.",
    });
  });

  it("a revoked token (401) marks the link revoked and deletes the token (check 11)", async () => {
    const l = await linked();
    const view = (await (await preview(l, { text: "Hi" })).json()) as { id: string };
    await standIn.revokeAll();
    const result = (await (await post(`/acts/${view.id}/send`, l.who)).json()) as { status: string; message: string };
    expect(result).toMatchObject({ status: "failed", message: "Your link to @ana@mastodon.stand-in.example stopped working. Link it again." });
    const { rows } = await admin.query<{ status: string; token_ciphertext: Buffer | null }>(
      "SELECT status, token_ciphertext FROM river.linked_accounts WHERE id = $1",
      [l.linkId],
    );
    expect(rows[0]).toEqual({ status: "revoked", token_ciphertext: null });
  });

  it("a 504 is unknown too", async () => {
    const l = await linked();
    const view = (await (await preview(l, { text: "Maybe" })).json()) as { id: string };
    await standIn.rules([{ path: "/api/v1/statuses", answer: 504 }]);
    expect(((await (await post(`/acts/${view.id}/send`, l.who)).json()) as { status: string }).status).toBe("unknown");
  });

  it("a timeout is unknown; Try again sends the same Idempotency-Key and the server keeps one post (check 12)", { timeout: 20_000 }, async () => {
    const l = await linked();
    const view = (await (await preview(l, { text: "Maybe" })).json()) as { id: string };
    // The server creates the post, but answers after the guard's 6 s.
    await standIn.rules([{ path: "/api/v1/statuses", answer: "slow" }]);
    const first = (await (await post(`/acts/${view.id}/send`, l.who)).json()) as { status: string; canRetry: boolean; message: string; checkUrl: string };
    expect(first).toMatchObject({
      status: "unknown",
      canRetry: true,
      message: "We couldn't tell whether mastodon.stand-in.example got it.",
      checkUrl: "https://mastodon.stand-in.example/@ana",
    });
    expect(await act(view.id)).toMatchObject({ status: "unknown" });

    await standIn.rules([]);
    const again = (await (await post(`/acts/${view.id}/retry`, l.who)).json()) as { status: string };
    expect(again.status).toBe("sent");
    const requests = await statusRequests();
    expect(requests.map((r) => r.headers["idempotency-key"])).toEqual([view.id, view.id]);
    expect(await standIn.statuses()).toHaveLength(1);
    expect((await act(view.id)).status).toBe("sent");
    // Once sent, there is nothing to try again.
    expect((await post(`/acts/${view.id}/retry`, l.who)).status).toBe(409);
  });

  it("after an hour only Check on is offered (check 12)", async () => {
    const l = await linked();
    // An act sent 61 minutes ago whose outcome is unknown (sent_at can't be moved once set).
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO river.member_actions (instance_id, account_id, channel, linked_account_id, target_host, verb, limit_kind,
                                         request, status, session_epoch, created_at, sent_at)
       SELECT l.instance_id, l.account_id, 'fediverse', l.id, l.server_host, 'post', 'text', $2, 'unknown', a.session_epoch,
              now() - interval '62 minutes', now() - interval '61 minutes'
         FROM river.linked_accounts l JOIN river.accounts a ON a.id = l.account_id WHERE l.id = $1
       RETURNING id`,
      [l.linkId, JSON.stringify({ method: "POST", url: "https://mastodon.stand-in.example/api/v1/statuses", body: { status: "Late", visibility: "public" } })],
    );
    const res = await post(`/acts/${rows[0]!.id}/retry`, l.who);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("cannot_retry");
    expect(await statusRequests()).toHaveLength(0);
  });

  it("on GoToSocial only Check on is offered (check 12)", async () => {
    const l = await linked("@bob@gts.stand-in.example", "bob");
    const view = (await (await preview(l, { text: "Maybe" })).json()) as { id: string };
    await standIn.rules([{ path: "/api/v1/statuses", answer: 502 }]);
    expect(await (await post(`/acts/${view.id}/send`, l.who)).json()).toMatchObject({ status: "unknown", canRetry: false });
    await standIn.rules([]);
    expect((await post(`/acts/${view.id}/retry`, l.who)).status).toBe(409);
    expect(await statusRequests()).toHaveLength(1);
  });

  it("a redirect on Send or on the search is a failure and reaches nothing (check 13)", async () => {
    const l = await linked();
    await standIn.rules([{ path: "/api/v2/search", answer: "redirect" }]);
    expect((await preview(l, { text: "Hi", replyToItemId: itemId })).status).toBe(502);
    await standIn.rules([{ path: "/api/v1/statuses", answer: "redirect" }]);
    const view = (await (await preview(l, { text: "Hi" })).json()) as { id: string };
    expect(((await (await post(`/acts/${view.id}/send`, l.who)).json()) as { status: string }).status).toBe("failed");
    expect((await standIn.requests()).filter((r) => r.host === "elsewhere.stand-in.example")).toHaveLength(0);
  });

  it("a connection refused is a failure: nothing was sent", async () => {
    const l = await linked();
    const view = (await (await preview(l, { text: "Hi" })).json()) as { id: string };
    await standIn.rules([{ path: "/api/v1/statuses", answer: "down" }]);
    expect(await (await post(`/acts/${view.id}/send`, l.who)).json()).toMatchObject({
      status: "failed",
      message: "We couldn't reach mastodon.stand-in.example. Nothing was sent.",
    });
  });

  it("the River's limit: the 31st post in an hour answers 429 and reaches no server (check 15)", async () => {
    const l = await linked();
    const accountId = (await admin.query<{ account_id: string }>("SELECT account_id FROM river.linked_accounts WHERE id = $1", [l.linkId])).rows[0]!.account_id;
    await admin.query(
      `INSERT INTO river.member_actions (instance_id, account_id, channel, target_host, verb, limit_kind, status, session_epoch, created_at, sent_at)
       SELECT a.instance_id, a.id, 'fediverse', 'mastodon.stand-in.example', 'post', 'text', 'sent', a.session_epoch, now() - interval '5 minutes', now() - interval '5 minutes'
         FROM river.accounts a, generate_series(1, 30) WHERE a.id = $1`,
      [accountId],
    );
    const view = (await (await preview(l, { text: "One too many" })).json()) as { id: string };
    const res = await post(`/acts/${view.id}/send`, l.who);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string; retryAt: string }).error).toBe("limit");
    expect(await statusRequests()).toHaveLength(0);
  });

  it("after Sign out everywhere, the old session can't send its preview (check 16)", async () => {
    const l = await linked();
    const view = (await (await preview(l, { text: "Stolen?" })).json()) as { id: string };
    expect((await post("/auth/signout-everywhere", l.who)).status).toBe(204);
    expect((await post(`/acts/${view.id}/send`, l.who)).status).toBe(401);
    expect(await statusRequests()).toHaveLength(0);
  });

  it("another member can't send or retry someone else's preview, and bad input is refused", async () => {
    const l = await linked();
    const other = await linked("@bob@mastodon.stand-in.example", "bob");
    const view = (await (await preview(l, { text: "Mine" })).json()) as { id: string };
    expect((await post(`/acts/${view.id}/send`, other.who)).status).toBe(400);
    expect((await post(`/acts/${view.id}/retry`, other.who)).status).toBe(400);
    expect((await preview(l, { text: "  " })).status).toBe(400);
    expect((await preview(l, { text: "Hi", visibility: "direct" })).status).toBe(400);
    expect((await post("/acts/fediverse/preview", l.who, { linkedAccountId: other.linkId, text: "Hi" })).status).toBe(409);
    expect(await statusRequests()).toHaveLength(0);
  });
});
