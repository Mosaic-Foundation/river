// Modes and plugins against the local database as river_app (spec F9, 4.7; checks 7 and 8), with
// recorded hub feeds replayed through the real fetch guard. A member's Civic mode reads the circle
// whose role is civic, whatever it is called; Coming up reads the current view; a civic-only
// instance opens in Civic. Each test makes its own member and spaces; the civic-only instance is
// inserted as postgres (river_app can't write instances) and deleted afterwards.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forAccount } from "../../../src/db/context.js";
import type { Viewer } from "../../../src/river/accounts.js";
import { memberFeed, visitorFeed, type FeedResponse } from "../../../src/river/feed/index.js";
import { FeedInputError } from "../../../src/river/feed/query.js";
import type { RefreshDeps } from "../../../src/river/feed/refresh.js";
import { clearInstanceCache, instanceForHost, type Instance } from "../../../src/river/instances.js";
import type { DateEntry } from "../../../src/river/plugins/api.js";
import { CIVIC_HUB_FIXTURE_NOW } from "../../fixtures/civicHubClock.js";
import { createHubSpace, DEMOSVILLE_FEED, LONGMONT_FEED, replayGuard } from "./feedHelpers.js";
import { ADMIN_URL, RIVER_URL, SEED_INSTANCE, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const now = CIVIC_HUB_FIXTURE_NOW;
const LONGMONT_DEADLINE = "2026-11-08T05:00:47.238Z";

let instance: Instance;

beforeAll(async () => {
  await requireDatabase(river, "river_app");
  await requireDatabase(admin, "postgres (inserting a test instance)");
  const found = await instanceForHost("river.mosaic.social", river);
  if (!found) throw new Error("seed instance missing");
  instance = found;
});

afterAll(async () => {
  await river.end();
  await admin.end();
});

function deps(): RefreshDeps {
  return { guard: replayGuard(), now, source: river, waitUntil: () => undefined };
}

async function newMember(): Promise<Viewer> {
  const accountId = randomUUID();
  await forAccount(SEED_INSTANCE, accountId, (db) => db.insert("accounts", { id: accountId }), river);
  return { accountId, did: null, displayName: null };
}

function as<T>(viewer: Viewer, fn: Parameters<typeof forAccount<T>>[2]): Promise<T> {
  return forAccount(SEED_INSTANCE, viewer.accountId, fn, river);
}

/** Every page of a member's feed; the first page's response (with its surfaces) and all items. */
async function feedOf(viewer: Viewer, params: Record<string, string> = {}) {
  const first = await memberFeed(instance, viewer, params, deps());
  const items = [...first.items];
  for (let cursor = first.nextCursor; cursor; ) {
    const page = await memberFeed(instance, viewer, { ...params, cursor }, deps());
    expect(page.surfaces).toBeNull(); // plugins run on the first page only
    items.push(...page.items);
    cursor = page.nextCursor;
  }
  return { first, items };
}

function comingUpOf(feed: FeedResponse): DateEntry[] | undefined {
  const plugin = feed.surfaces?.["river.panel"]?.find((p) => p.id === "coming-up");
  return plugin?.output.type === "dates" ? [...plugin.output.entries] : undefined;
}

describe("check 7: a member's Civic mode", () => {
  it("shows civic spaces plus the civic-role circle's members, found by role, with the panel", async () => {
    const member = await newMember();
    const longmont = await createHubSpace(river, LONGMONT_FEED, { name: "Longmont (modes)" });
    // A space that isn't civic by category: only the civic-role circle can bring it into Civic.
    const club = await createHubSpace(river, DEMOSVILLE_FEED, { name: "Book club (modes)", category: "club" });
    const { civic, decoy } = await as(member, async (db) => {
      for (const space of [longmont, club]) await db.insert("follows", { space_id: space.id, rule: "follow" });
      // The role makes the circle, not the name: "Our town" carries the civic role, and a circle
      // merely named "Civic" does not.
      const civicCircle = await db.insert<{ id: string }>("circles", { name: "Our town", color: "#2F6FA8", role: "civic", sort: 0 });
      const decoyCircle = await db.insert<{ id: string }>("circles", { name: "Civic", color: "#7A5AA6", sort: 1 });
      return { civic: civicCircle, decoy: decoyCircle };
    });

    // Everything: both spaces, the Mosaic theme, no panel.
    const everything = await feedOf(member);
    expect(new Set(everything.items.map((i) => i.space.id))).toEqual(new Set([longmont.id, club.id]));
    expect(everything.first).toMatchObject({ mode: "everything", theme: "mosaic", surfaces: {} });
    expect(everything.first.modes).toEqual([
      { id: "everything", title: "Everything" },
      { id: "civic", title: "Civic" },
    ]);

    // Civic, club in no circle: only the civic-category hub.
    let civicFeed = await feedOf(member, { mode: "civic" });
    expect(new Set(civicFeed.items.map((i) => i.space.id))).toEqual(new Set([longmont.id]));
    expect(civicFeed.first).toMatchObject({ mode: "civic", theme: "civic" });

    // In the circle named "Civic" (no role): still out.
    await as(member, (db) => db.insert("circle_members", { circle_id: decoy.id, space_id: club.id }));
    civicFeed = await feedOf(member, { mode: "civic" });
    expect(civicFeed.items.some((i) => i.space.id === club.id)).toBe(false);

    // In the civic-role circle "Our town": in.
    await as(member, (db) => db.insert("circle_members", { circle_id: civic.id, space_id: club.id }));
    civicFeed = await feedOf(member, { mode: "civic" });
    expect(new Set(civicFeed.items.map((i) => i.space.id))).toEqual(new Set([longmont.id, club.id]));

    // The panel: Coming up with the recorded voting_closes_at, then the two placeholders.
    const panel = civicFeed.first.surfaces?.["river.panel"] ?? [];
    expect(panel.map((p) => p.id)).toEqual(["coming-up", "your-representatives", "elections-and-ballot"]);
    const comingUp = comingUpOf(civicFeed.first)!;
    expect(comingUp.map((e) => e.date)).toContain(LONGMONT_DEADLINE);
    expect(comingUp.map((e) => e.date)).toEqual([...comingUp.map((e) => e.date)].sort());
    expect(comingUp.every((e) => Date.parse(e.date) >= now.getTime())).toBe(true);
    expect(comingUp.length).toBeLessThanOrEqual(5);
    expect(comingUp.find((e) => e.date === LONGMONT_DEADLINE)).toMatchObject({ what: "deadline", spaceName: "Longmont (modes)" });
    // One entry per process and date, though the hub announced the deadline more than once.
    expect(new Set(comingUp.map((e) => `${e.date}|${e.what}`)).size).toBe(comingUp.length);
  });

  it("Coming up reads the current view: hidden when the view has no dates, placeholders stay", async () => {
    const member = await newMember();
    const longmont = await createHubSpace(river, LONGMONT_FEED, { name: "Longmont (modes view)" });
    await as(member, (db) => db.insert("follows", { space_id: longmont.id, rule: "follow" }));
    const all = await feedOf(member, { mode: "civic" });
    expect(comingUpOf(all.first)).toBeDefined();

    // No posts in a hub: an empty view, so no dates, but the slots still show.
    const posts = await memberFeed(instance, member, { mode: "civic", type: "posts" }, deps());
    expect(posts.items).toEqual([]);
    expect(posts.surfaces?.["river.panel"]?.map((p) => p.id)).toEqual(["your-representatives", "elections-and-ballot"]);

    // A search that matches nothing with a deadline.
    const search = await memberFeed(instance, member, { mode: "civic", q: "zzzz-no-such-word" }, deps());
    expect(comingUpOf(search)).toBeUndefined();
  });

  it("Everything's Coming up still finds a vote when hundreds of newer posts follow it", async () => {
    // A busy feed (Bluesky, the fediverse) posts far more than a hub: the newest 500 items can all
    // be posts, and the hub's deadline was announced before them.
    const member = await newMember();
    const longmont = await createHubSpace(river, LONGMONT_FEED, { name: "Longmont (modes busy)" });
    const busy = (
      await admin.query<{ id: string }>(
        `INSERT INTO river.spaces (adapter, canonical_url, name, last_fetched_at) VALUES ('rss', $1, 'Busy feed (modes)', $2)
         RETURNING id`,
        [`https://busy-feed.invalid/${randomUUID()}`, now],
      )
    ).rows[0]!.id;
    await admin.query(
      `INSERT INTO river.items (space_id, source_id, kind, published_at, title)
       SELECT $1, 'busy-' || g, 'post', $2::timestamptz - make_interval(secs => g), 'Busy post ' || g
         FROM generate_series(1, 520) g`,
      [busy, now],
    );
    await as(member, async (db) => {
      for (const space of [longmont.id, busy]) await db.insert("follows", { space_id: space, rule: "follow" });
    });
    const first = await memberFeed(instance, member, { mode: "everything" }, deps());
    expect(first.items[0]?.space.id).toBe(busy);
    expect(comingUpOf(first)?.map((e) => e.date)).toContain(LONGMONT_DEADLINE);
  });
});

describe("check 8: an instance with modes_enabled = [civic]", () => {
  const hostname = `civic-only-${randomUUID().slice(0, 8)}.test.invalid`;
  let civicOnly: Instance;

  beforeAll(async () => {
    // Same seeds as river.mosaic.social, Civic only, opening in Civic.
    await admin.query(
      `INSERT INTO river.instances (hostname, name, theme, modes_enabled, default_mode, seed_follows, default_circles, plugins)
       SELECT $1, 'Civic only (test)', 'civic', ARRAY['civic'], 'civic', seed_follows, default_circles, '[]'::jsonb
         FROM river.instances WHERE id = $2`,
      [hostname, SEED_INSTANCE],
    );
    clearInstanceCache();
    const found = await instanceForHost(hostname, river);
    if (!found) throw new Error("test instance missing");
    civicOnly = found;
  });

  afterAll(async () => {
    await admin.query("DELETE FROM river.instances WHERE hostname = $1", [hostname]);
    clearInstanceCache();
  });

  it("opens in Civic with the Civic theme and the panel, offers one mode, and refuses Everything", async () => {
    const feed = await visitorFeed(civicOnly, {}, deps());
    expect(feed).toMatchObject({ mode: "civic", theme: "civic", modes: [{ id: "civic", title: "Civic" }] });
    expect(feed.instance).toMatchObject({ modes: ["civic"], defaultMode: "civic" });
    expect(feed.items.length).toBeGreaterThan(0);
    expect(feed.items.every((i) => i.space.category === "civic")).toBe(true);
    expect(feed.surfaces?.["river.panel"]?.map((p) => p.id)).toEqual([
      "coming-up",
      "your-representatives",
      "elections-and-ballot",
    ]);
    await expect(visitorFeed(civicOnly, { mode: "everything" }, deps())).rejects.toThrow(FeedInputError);
  });

  it("can turn a plugin off in its config", async () => {
    await admin.query(`UPDATE river.instances SET plugins = '[{"id": "coming-up", "enabled": false}]' WHERE hostname = $1`, [hostname]);
    clearInstanceCache();
    const off = (await instanceForHost(hostname, river))!;
    const feed = await visitorFeed(off, {}, deps());
    expect(feed.surfaces?.["river.panel"]?.map((p) => p.id)).toEqual(["your-representatives", "elections-and-ballot"]);
  });
});
