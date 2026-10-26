// "Import from Bluesky" over HTTP (docs/spec/bluesky-1.md item 4), against the running dev server
// (`npm run dev`, with FETCH_FIXTURES_DIR and TEST_CLOCK_NOW as tests/api/README.md describes).
// The preview lists who @eff.org follows, with a count; the import follows them all into a
// chosen circle, keyed by DID, skipping nothing it shouldn't and following nothing twice. The
// responses are real recordings of app.bsky.graph.getFollows (three pages), replayed through the
// real fetch guard.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL } from "./db/roles.js";
import { API, DidLogServer, requireApi, type Member } from "./helpers/member.js";

const EFF_DID = "did:plc:lr36xv2l64jwtnyoaqem6z2z";

interface ImportPreview {
  account: { did: string; name: string; handle: string | null; iconUrl: string | null };
  count: number;
  skipped: number;
  truncated: boolean;
  accounts: Array<{ did: string; name: string; handle: string | null; iconUrl: string | null }>;
  removals: Array<{ spaceId: string; did: string; name: string; address: string; iconUrl: string | null; fromThisImport: boolean }> | null;
  incomplete: boolean;
}

interface ImportResult {
  total: number;
  followed: number;
  alreadyFollowing: number;
  unfollowed: number;
  skipped: number;
  truncated: boolean;
  refresh: { claimed: string[]; pending: string[] };
}

interface Page {
  spaces: Array<{ id: string; adapter: string; address: string; following: boolean; circleIds: string[] }>;
  circles: Array<{ id: string; name: string; spaceIds: string[] }>;
}

const logs = new DidLogServer();
let member: Member;

beforeAll(async () => {
  await requireApi();
  await logs.start();
  await fetch(`${API}/feed`);
  member = await logs.signIn();
}, 30_000);

afterAll(async () => {
  await logs.close();
});

function call(method: string, path: string, body?: unknown, who: Member = member): Promise<Response> {
  return fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: who.cookie, origin: who.origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function page(): Promise<Page> {
  const res = await call("GET", "/following");
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
}

describe("Import from Bluesky (docs/spec/bluesky-1.md item 4)", () => {
  let preview: ImportPreview;

  it("members only, from the River's own pages", async () => {
    for (const path of ["/follow/bluesky/preview", "/follow/bluesky/import"]) {
      const visitor = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: member.origin },
        body: JSON.stringify({ input: "@eff.org" }),
      });
      expect(visitor.status, path).toBe(401);
      const foreign = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: member.cookie, origin: "https://evil.example" },
        body: JSON.stringify({ input: "@eff.org" }),
      });
      expect(foreign.status, path).toBe(403);
    }
  });

  it("previews who @eff.org follows, with a count and the first names; stores nothing", async () => {
    const before = await page();
    const res = await call("POST", "/follow/bluesky/preview", { input: "@eff.org" });
    expect(res.status).toBe(200);
    preview = (await res.json()) as ImportPreview;
    expect(preview.account).toMatchObject({ did: EFF_DID, handle: "eff.org" });
    expect(preview.count).toBeGreaterThan(200);
    expect(preview.skipped).toBeGreaterThan(0);
    expect(preview.truncated).toBe(false);
    expect(preview.accounts).toHaveLength(12);
    expect(preview.accounts.every((a) => a.did.startsWith("did:"))).toBe(true);
    expect((await page()).spaces.length).toBe(before.spaces.length);
  });

  it("follows them all into the chosen circle, keyed by DID; a second import adds nothing", async () => {
    const made = await call("POST", "/circles", { name: "From Bluesky", color: "#2F6FA8" });
    const { circle } = (await made.json()) as { circle: { id: string } };

    const res = await call("POST", "/follow/bluesky/import", { input: "@eff.org", circleIds: [circle.id] });
    expect(res.status).toBe(201);
    const result = (await res.json()) as ImportResult;
    expect(result).toMatchObject({ total: preview.count, followed: preview.count, alreadyFollowing: 0, skipped: preview.skipped });
    // The import refreshes only a capped few within the budget; the rest fill in over later opens.
    expect(result.refresh.claimed.length).toBeLessThanOrEqual(12);

    const after = await page();
    const bluesky = after.spaces.filter((s) => s.adapter === "atproto" && s.following);
    expect(bluesky.length).toBeGreaterThanOrEqual(preview.count);
    const inCircle = after.circles.find((c) => c.id === circle.id)!;
    expect(inCircle.spaceIds).toHaveLength(preview.count);
    const named = bluesky.find((s) => preview.accounts[0]?.handle && s.address === `@${preview.accounts[0].handle}`);
    expect(named?.circleIds).toContain(circle.id);

    const again = await call("POST", "/follow/bluesky/import", { input: "https://bsky.app/profile/eff.org" });
    expect(again.status).toBe(201);
    expect((await again.json()) as ImportResult).toMatchObject({ followed: 0, alreadyFollowing: preview.count });
    expect((await page()).spaces.filter((s) => s.adapter === "atproto").length).toBe(
      after.spaces.filter((s) => s.adapter === "atproto").length,
    );
  });

  it("a feed open with hundreds of Bluesky follows refreshes a capped few", async () => {
    const res = await fetch(`${API}/feed`, { headers: { cookie: member.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { refresh: { claimed: string[] } };
    const page1 = await page();
    const blueskyIds = new Set(page1.spaces.filter((s) => s.adapter === "atproto").map((s) => s.id));
    expect(body.refresh.claimed.filter((id) => blueskyIds.has(id)).length).toBeLessThanOrEqual(12);
  });

  it("answers in the follow box's words", async () => {
    const bad = await call("POST", "/follow/bluesky/preview", { input: "https://demosville.civic.social" });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { message: string }).message).toBe("That address isn't a Space we can follow");
    const empty = await call("POST", "/follow/bluesky/import", { input: "" });
    expect(empty.status).toBe(422);
    const circles = await call("POST", "/follow/bluesky/import", { input: "@eff.org", circleIds: ["Friends"] });
    expect(circles.status).toBe(400);
  });
});

// Accounts the member follows here that the imported account no longer follows: listed in the
// preview, unfollowed only when the member confirms them (ui follow-up, Adam 2026-10-25).
describe("Import from Bluesky removes accounts it no longer follows, once confirmed", () => {
  const BSKY_DID = "did:plc:z72i7hdynmk6r22z27h6tvur"; // @bsky.app: @eff.org doesn't follow it
  let other: Member;
  const as = (method: string, path: string, body?: unknown) => call(method, path, body, other);
  const spaces = async () => ((await (await as("GET", "/following")).json()) as Page).spaces;

  beforeAll(async () => {
    other = await logs.signIn();
    for (const input of ["@bsky.app", "@eff.org"]) {
      const res = await as("POST", "/follows", { input, scope: "space", circleIds: [] });
      expect(res.status, input).toBe(201);
    }
  }, 30_000);

  it("the preview lists @bsky.app, not @eff.org itself or anyone it follows", async () => {
    const res = await as("POST", "/follow/bluesky/preview", { input: "@eff.org" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportPreview;
    expect(body.incomplete).toBe(false);
    const bsky = body.removals?.find((r) => r.did === BSKY_DID);
    expect(bsky).toMatchObject({ address: "@bsky.app" });
    expect(body.removals?.some((r) => r.did === EFF_DID)).toBe(false);
    // Nobody @eff.org still follows is offered: the member follows only @bsky.app and @eff.org
    // among Bluesky accounts (and the instance seeds none), so @bsky.app is the only removal.
    expect(body.removals?.map((r) => r.did)).toEqual([BSKY_DID]);
    // Nothing changed yet.
    expect((await spaces()).find((s) => s.id === bsky!.spaceId)?.following).toBe(true);
  });

  it("an import without confirmations unfollows nobody; with one, just that account", async () => {
    const preview = (await (await as("POST", "/follow/bluesky/preview", { input: "@eff.org" })).json()) as ImportPreview;
    const bsky = preview.removals!.find((r) => r.did === BSKY_DID)!;
    const hub = (await spaces()).find((s) => s.adapter === "civic_hub" && s.following)!;

    const plain = await as("POST", "/follow/bluesky/import", { input: "@eff.org" });
    expect(plain.status).toBe(201);
    expect(((await plain.json()) as ImportResult).unfollowed).toBe(0);
    expect((await spaces()).find((s) => s.id === bsky.spaceId)?.following).toBe(true);

    // A space that isn't on the removal list (a hub) is ignored, never unfollowed.
    const res = await as("POST", "/follow/bluesky/import", { input: "@eff.org", unfollow: [bsky.spaceId, hub.id] });
    expect(res.status).toBe(201);
    expect(((await res.json()) as ImportResult).unfollowed).toBe(1);
    const after = await spaces();
    expect(after.find((s) => s.id === bsky.spaceId)?.following ?? false).toBe(false);
    expect(after.find((s) => s.id === hub.id)?.following).toBe(true);
    expect(after.find((s) => s.adapter === "atproto" && s.address === "@eff.org")?.following).toBe(true);

    // The next preview offers nobody: @bsky.app is gone, and the hundreds just imported are still
    // followed by @eff.org.
    const next = (await (await as("POST", "/follow/bluesky/preview", { input: "@eff.org" })).json()) as ImportPreview;
    expect(next.removals).toEqual([]);
  });

  it("a malformed unfollow list is a 400", async () => {
    for (const unfollow of ["all", [7], ["not-a-uuid"]]) {
      const res = await as("POST", "/follow/bluesky/import", { input: "@eff.org", unfollow });
      expect(res.status, JSON.stringify(unfollow)).toBe(400);
    }
  });
});

// Where each follow came from (migration follow_origin, Adam 2026-10-25): the import offers the
// follows it added from the same account checked, and every other one unchecked.
describe("follow origins, and an import offering only its own follows", () => {
  const BSKY_DID = "did:plc:z72i7hdynmk6r22z27h6tvur";
  // A stand-in account an earlier @eff.org import added that @eff.org has since unfollowed.
  const GONE_DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
  let third: Member;
  let accountId: string;
  const as = (method: string, path: string, body?: unknown) => call(method, path, body, third);
  const admin = async <T,>(fn: (client: pg.Client) => Promise<T>): Promise<T> => {
    const client = new pg.Client({ connectionString: ADMIN_URL });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  };
  const origins = () =>
    admin(async (c) =>
      (
        await c.query<{ canonical_url: string; origin: string; origin_ref: string | null; origin_label: string | null }>(
          `SELECT s.canonical_url, f.origin, f.origin_ref, f.origin_label
             FROM river.follows f JOIN river.spaces s ON s.id = f.space_id
            WHERE f.account_id = $1 AND f.stream_id IS NULL`,
          [accountId],
        )
      ).rows,
    );

  beforeAll(async () => {
    third = await logs.signIn();
    accountId = await admin(async (c) => (await c.query<{ account_id: string }>("SELECT account_id FROM river.login_methods WHERE did = $1", [third.did])).rows[0]!.account_id);
  }, 30_000);

  it("records seed, manual and bluesky_import (with the account's DID and handle)", async () => {
    const seeded = await origins();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((r) => r.origin === "seed")).toBe(true);

    expect((await as("POST", "/follows", { input: "@bsky.app", scope: "space", circleIds: [] })).status).toBe(201);
    expect((await origins()).find((r) => r.canonical_url === `at://${BSKY_DID}`)).toMatchObject({ origin: "manual", origin_ref: null });

    // One account @eff.org follows is already followed by hand before the import.
    const preview = (await (await as("POST", "/follow/bluesky/preview", { input: "@eff.org" })).json()) as ImportPreview;
    const handFollowed = preview.accounts[0]!.did;
    await admin(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO river.spaces (adapter, canonical_url, name, network, category)
         VALUES ('atproto', $1, 'Followed by hand', 'bluesky', 'person')
         ON CONFLICT (canonical_url) DO UPDATE SET canonical_url = EXCLUDED.canonical_url RETURNING id`,
        [`at://${handFollowed}`],
      );
      await c.query(
        `INSERT INTO river.follows (instance_id, account_id, space_id, origin)
         SELECT a.instance_id, a.id, $2, 'manual' FROM river.accounts a WHERE a.id = $1`,
        [accountId, rows[0]!.id],
      );
    });

    expect((await as("POST", "/follow/bluesky/import", { input: "@eff.org" })).status).toBe(201);
    const imported = (await origins()).filter((r) => r.origin === "bluesky_import");
    expect(imported.length).toBeGreaterThan(200);
    expect(imported.every((r) => r.origin_ref === EFF_DID && r.origin_label === "eff.org")).toBe(true);
    // An import over a follow made another way leaves its origin alone (it's never "this import's").
    expect((await origins()).find((r) => r.canonical_url === `at://${handFollowed}`)?.origin).toBe("manual");
  });

  it("a stream rule is the member's own: origin manual", async () => {
    const pageBody = (await (await as("GET", "/following")).json()) as {
      spaces: Array<{ streams: Array<{ id: string; rule: string | null }> }>;
    };
    const stream = pageBody.spaces.flatMap((s) => s.streams).find((st) => st.rule === null);
    expect(stream).toBeDefined();
    expect((await as("PUT", `/following/streams/${stream!.id}`, { rule: "mute" })).status).toBeLessThan(300);
    const rule = await admin(async (c) => (await c.query<{ origin: string }>("SELECT origin FROM river.follows WHERE account_id = $1 AND stream_id = $2", [accountId, stream!.id])).rows[0]);
    expect(rule?.origin).toBe("manual");
  });

  it("offers what an earlier @eff.org import added as fromThisImport, and the rest as not", async () => {
    // @eff.org "unfollowed" an account it once had: a space and an import-origin follow for it.
    const goneSpace = await admin(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO river.spaces (adapter, canonical_url, name, network, category, manifest)
         VALUES ('atproto', $1, 'Gone Account', 'bluesky', 'person', '{"actor":{"handle":"@gone.example"}}')
         ON CONFLICT (canonical_url) DO UPDATE SET name = EXCLUDED.name, manifest = EXCLUDED.manifest RETURNING id`,
        [`at://${GONE_DID}`],
      );
      const instance = (await c.query<{ instance_id: string }>("SELECT instance_id FROM river.accounts WHERE id = $1", [accountId])).rows[0]!.instance_id;
      await c.query(
        `INSERT INTO river.follows (instance_id, account_id, space_id, origin, origin_ref, origin_label)
         VALUES ($1, $2, $3, 'bluesky_import', $4, 'eff.org')`,
        [instance, accountId, rows[0]!.id, EFF_DID],
      );
      return rows[0]!.id;
    });

    const preview = (await (await as("POST", "/follow/bluesky/preview", { input: "@eff.org" })).json()) as ImportPreview;
    const byDid = new Map((preview.removals ?? []).map((r) => [r.did, r]));
    expect(byDid.get(GONE_DID)).toMatchObject({ spaceId: goneSpace, fromThisImport: true, address: "@gone.example" });
    expect(byDid.get(BSKY_DID)).toMatchObject({ fromThisImport: false });
    expect(preview.removals).toHaveLength(2);

    // An import from another account would not count @eff.org's follows as its own.
    const other = await admin(async (c) =>
      (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM river.follows WHERE account_id = $1 AND origin = 'bluesky_import' AND origin_ref <> $2", [accountId, EFF_DID])).rows[0]!.n,
    );
    expect(other).toBe(0);

    const res = await as("POST", "/follow/bluesky/import", { input: "@eff.org", unfollow: [goneSpace] });
    expect(((await res.json()) as ImportResult).unfollowed).toBe(1);
    expect((await origins()).some((r) => r.canonical_url === `at://${GONE_DID}`)).toBe(false);
    expect((await origins()).some((r) => r.canonical_url === `at://${BSKY_DID}`)).toBe(true);
  });

  it("the Following page gives each space its origin, and null for unknown", async () => {
    // A follow from before origins were kept: inserted without one, so it reads 'unknown'.
    await admin(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO river.spaces (adapter, canonical_url, name, network, category)
         VALUES ('atproto', 'at://did:plc:cccccccccccccccccccccccc', 'Old Follow', 'bluesky', 'person')
         ON CONFLICT (canonical_url) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      );
      await c.query(
        `INSERT INTO river.follows (instance_id, account_id, space_id)
         SELECT a.instance_id, a.id, $2 FROM river.accounts a WHERE a.id = $1`,
        [accountId, rows[0]!.id],
      );
    });
    const page = (await (await as("GET", "/following")).json()) as {
      spaces: Array<{ name: string; address: string; origin: { origin: string; label: string | null } | null }>;
    };
    const byOrigin = (o: string) => page.spaces.filter((s) => s.origin?.origin === o);
    expect(byOrigin("seed").length).toBeGreaterThan(0);
    expect(page.spaces.find((s) => s.address === "@bsky.app")?.origin).toEqual({ origin: "manual", label: null });
    expect(byOrigin("bluesky_import").length).toBeGreaterThan(200); // the import above, less the one it unfollowed
    expect(byOrigin("bluesky_import").every((s) => s.origin!.label === "eff.org")).toBe(true);
    expect(page.spaces.find((s) => s.name === "Old Follow")?.origin).toBeNull();
  });
});
