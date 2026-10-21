// Following (spec F6, F7, F8; checks 14, 17, 18, 19 and 27's new rows) against the local database
// as river_app, with recorded hub feeds replayed through the real fetch guard. Each test makes its
// own member and its own hub spaces (unique canonical URLs reading the recorded feeds), so nothing
// here depends on, or changes, the seed spaces the dev server and the e2e tests use. The daily job
// runs as postgres (as pg_cron does) inside a transaction that is rolled back.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forAccount, forInstance } from "../../../src/db/context.js";
import type { SpacePreview } from "../../../src/shared/items/index.js";
import type { Viewer } from "../../../src/river/accounts.js";
import { memberFeed } from "../../../src/river/feed/index.js";
import type { RefreshDeps } from "../../../src/river/feed/refresh.js";
import type { SpaceRow } from "../../../src/river/feed/spaces.js";
import { instanceForHost, type Instance } from "../../../src/river/instances.js";
import {
  addCircleMember,
  createCircle,
  deleteCircle,
  removeCircleMember,
  updateCircle,
} from "../../../src/river/following/circles.js";
import {
  FollowingError,
  followingPage,
  followPreview,
  removeRule,
  setStreamRule,
  STREAMS_PER_SPACE,
  unfollowQuiet,
  unfollowSpace,
} from "../../../src/river/following/service.js";
import { CIVIC_HUB_FIXTURE_NOW } from "../../fixtures/civicHubClock.js";
import { createHubSpace, LONGMONT_FEED, replayGuard } from "./feedHelpers.js";
import { ADMIN_URL, RIVER_URL, SEED_INSTANCE, refusal, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const now = CIVIC_HUB_FIXTURE_NOW;
const DAY = 24 * 60 * 60 * 1000;
const FLOYD_FEED = "https://floyd.civic.social/events";
const VOTE = "https://floyd.civic.social/process/proc_beta_vote_energy_001";
const MEETING = "https://longmont.civic.social/process/proc_4ebb11759c4c40ce";

let instance: Instance;

beforeAll(async () => {
  await requireDatabase(river, "river_app");
  await requireDatabase(admin, "postgres (daily job only)");
  const found = await instanceForHost("river.mosaic.social", river);
  if (!found) throw new Error("seed instance missing");
  instance = found;
});

afterAll(async () => {
  await river.end();
  await admin.end();
});

/** A member with no follows or circles of their own (not a seed copy). */
async function newMember(): Promise<Viewer> {
  const accountId = randomUUID();
  await forAccount(SEED_INSTANCE, accountId, (db) => db.insert("accounts", { id: accountId }), river);
  return { accountId, did: null, displayName: null };
}

function as<T>(viewer: Viewer, fn: Parameters<typeof forAccount<T>>[2]): Promise<T> {
  return forAccount(SEED_INSTANCE, viewer.accountId, fn, river);
}

/** What the hub adapter's resolve returns for a test space (no request needed). */
function previewOf(space: SpaceRow, streamKey?: string): SpacePreview {
  return {
    adapter: "civic_hub",
    canonicalUrl: space.canonical_url,
    name: space.name,
    feedUrl: space.feed_url ?? undefined,
    category: "civic",
    manifest: {},
    ...(streamKey ? { stream: { key: streamKey } } : {}),
  };
}

function deps(): RefreshDeps {
  return { guard: replayGuard(), now, source: river, waitUntil: () => undefined };
}

/** The member's whole feed: the first page (which refreshes) and every later page. */
async function feedOf(viewer: Viewer) {
  const first = await memberFeed(instance, viewer, {}, deps());
  const items = [...first.items];
  for (let cursor = first.nextCursor; cursor; ) {
    const page = await memberFeed(instance, viewer, { cursor }, deps());
    items.push(...page.items);
    cursor = page.nextCursor;
  }
  return { ...first, items };
}

describe("check 18: a followed stream ends; End, Aggregation and Result arrive; the Result outlives retention", () => {
  it("runs the recorded Floyd vote end to end", async () => {
    const member = await newMember();
    const floyd = await createHubSpace(river, FLOYD_FEED, { name: "Floyd (check 18)" });

    // Just this stream, before the space was ever fetched: the follow starts open.
    const followed = await as(member, (db) => followPreview(db, previewOf(floyd, VOTE), { scope: "stream", circleIds: [] }));
    expect(followed.streamId).toBeTruthy();
    const before = await as(member, (db) => followingPage(db, now));
    expect(before.spaces.map((s) => [s.id, s.following, s.streams.map((st) => [st.key, st.rule])])).toEqual([
      [floyd.id, false, [[VOTE, "follow"]]],
    ]);
    expect(before.ended).toEqual([]);

    // The member's feed refreshes the space (the recorded first fetch) and shows only that stream.
    const feed = await feedOf(member);
    expect(feed.refresh.claimed).toEqual([floyd.id]);
    expect(feed.items.length).toBeGreaterThan(0);
    expect(new Set(feed.items.map((i) => i.streamKey))).toEqual(new Set([VOTE]));
    const civic = (i: (typeof feed.items)[number]) => i.civic as { activityType: string; objectType: string };
    const end = feed.items.find((i) => civic(i).activityType === "civic:End")!;
    const aggregation = feed.items.find((i) => civic(i).objectType === "hub:Aggregation")!;
    const result = feed.items.find((i) => civic(i).activityType === "Announce" && civic(i).objectType === "civic:Result")!;
    expect(end && aggregation && result).toBeTruthy();
    expect(end.publishedAt < aggregation.publishedAt && aggregation.publishedAt < result.publishedAt).toBe(true);
    expect(feed.items.filter((i) => i.isFinalResult).map((i) => i.id)).toEqual([result.id]);

    // The stream ended, so the follow moved to Ended and is no longer under Spaces.
    const after = await as(member, (db) => followingPage(db, now));
    expect(after.spaces).toEqual([]);
    expect(after.ended).toEqual([
      expect.objectContaining({
        ruleId: followed.ruleId,
        rule: "follow",
        space: expect.objectContaining({ id: floyd.id, address: new URL(floyd.canonical_url).host }),
        stream: expect.objectContaining({ id: followed.streamId, key: VOTE }),
      }),
    ]);
    // An ended follow still shows what its stream stored (DECISIONS "Ended follows in the feed").
    expect((await feedOf(member)).items.map((i) => i.id)).toContain(result.id);

    // 120 days on, the daily job keeps the final result and clears the rest and the follow.
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT river.daily_job(now() + interval '120 days')");
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM river.items WHERE space_id = $1 AND stream_key = $2",
        [floyd.id, VOTE],
      );
      expect(rows.map((r) => r.id)).toEqual([result.id]);
      const follows = await client.query("SELECT 1 FROM river.follows WHERE id = $1", [followed.ruleId]);
      expect(follows.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("following a stream that has already ended puts it straight under Ended", async () => {
    const member = await newMember();
    const floyd = await createHubSpace(river, FLOYD_FEED, { name: "Floyd (ended already)" });
    const other = await newMember();
    await as(other, (db) => followPreview(db, previewOf(floyd), { scope: "space", circleIds: [] }));
    await feedOf(other); // fetches Floyd; the vote's stream ends
    await as(member, (db) => followPreview(db, previewOf(floyd, VOTE), { scope: "stream", circleIds: [] }));
    const page = await as(member, (db) => followingPage(db, now));
    expect(page.spaces).toEqual([]);
    expect(page.ended.map((e) => e.stream.key)).toEqual([VOTE]);
    // Clearing it removes it.
    await as(member, (db) => removeRule(db, page.ended[0]!.ruleId));
    expect((await as(member, (db) => followingPage(db, now))).ended).toEqual([]);
  });
});

describe("check 17 (and 14's feed half): the most specific rule wins", () => {
  it("a muted stream is hidden inside a followed space; unmuting shows it again", async () => {
    const member = await newMember();
    const floyd = await createHubSpace(river, FLOYD_FEED, { name: "Floyd (check 17)" });
    await as(member, (db) => followPreview(db, previewOf(floyd), { scope: "space", circleIds: [] }));
    const all = await feedOf(member);
    // The page offers the space's known streams (newest first, a few) to mute or follow.
    const page = await as(member, (db) => followingPage(db, now));
    const streams = page.spaces[0]!.streams;
    expect(streams.length).toBeGreaterThan(1);
    expect(streams.length).toBeLessThanOrEqual(STREAMS_PER_SPACE);
    const target = streams[0]!;
    expect(target).toMatchObject({ rule: null, ruleId: null });
    expect(all.items.some((i) => i.streamKey === target.key)).toBe(true);

    const muted = await as(member, (db) => setStreamRule(db, target.id, "mute"));
    const hidden = await feedOf(member);
    expect(hidden.items.some((i) => i.streamKey === target.key)).toBe(false);
    expect(hidden.items.length).toBe(all.items.filter((i) => i.streamKey !== target.key).length);
    const mutedPage = await as(member, (db) => followingPage(db, now));
    expect(mutedPage.spaces[0]!.streams[0]).toMatchObject({ key: target.key, rule: "mute", ruleId: muted.ruleId });

    await as(member, (db) => removeRule(db, muted.ruleId));
    expect((await feedOf(member)).items.length).toBe(all.items.length);
  });

  it("a followed stream in a space that isn't followed shows only that stream (Longmont meeting summary)", async () => {
    const member = await newMember();
    const longmont = await createHubSpace(river, LONGMONT_FEED, { name: "Longmont (check 14)" });
    await as(member, (db) => followPreview(db, previewOf(longmont, MEETING), { scope: "stream", circleIds: [] }));
    const feed = await feedOf(member);
    expect(feed.items.length).toBeGreaterThan(0);
    expect(new Set(feed.items.map((i) => i.streamKey))).toEqual(new Set([MEETING]));
    // Following the whole space as well shows the rest of it.
    await as(member, (db) => followPreview(db, previewOf(longmont), { scope: "space", circleIds: [] }));
    expect(new Set((await feedOf(member)).items.map((i) => i.streamKey)).size).toBeGreaterThan(1);
    // Unfollowing the space removes both rules.
    await as(member, (db) => unfollowSpace(db, longmont.id));
    expect((await feedOf(member)).items).toEqual([]);
  });

  it("a stream rule can't name a stream of another space, and a whole-space follow happens once", async () => {
    const member = await newMember();
    const a = await createHubSpace(river, FLOYD_FEED);
    const b = await createHubSpace(river, FLOYD_FEED);
    const { streamId } = await as(member, (db) => followPreview(db, previewOf(a, VOTE), { scope: "stream", circleIds: [] }));
    const cross = await refusal(() =>
      as(member, (db) => db.query("INSERT INTO river.follows (space_id, stream_id) VALUES ($1, $2)", [b.id, streamId])),
    );
    expect(cross.code).toBe("23503");
    await as(member, (db) => followPreview(db, previewOf(b), { scope: "space", circleIds: [] }));
    await as(member, (db) => followPreview(db, previewOf(b), { scope: "space", circleIds: [] }));
    const rows = await as(member, (db) => db.query("SELECT 1 FROM river.follows WHERE space_id = $1", [b.id]));
    expect(rows.rowCount).toBe(1);
    // "Just this stream" needs an address that names one.
    await expect(as(member, (db) => followPreview(db, previewOf(b), { scope: "stream", circleIds: [] }))).rejects.toBeInstanceOf(
      FollowingError,
    );
  });
});

describe("check 19: Quiet", () => {
  async function space(columns: Record<string, unknown>): Promise<string> {
    return forInstance(
      SEED_INSTANCE,
      async (db) => (await db.insert<{ id: string }>("spaces", { name: `Quiet test ${randomUUID().slice(0, 8)}`, ...columns })).id,
      river,
    );
  }

  it("lists followed spaces with nothing new in 90 days, never samples, and unfollows them all", async () => {
    const member = await newMember();
    const at = new Date();
    const old = new Date(at.getTime() - 120 * DAY).toISOString();
    const quiet = await space({ adapter: "civic_hub", canonical_url: `https://quiet.invalid/${randomUUID()}`, newest_item_at: old, last_fetched_at: at.toISOString() });
    const silent = await space({ adapter: "fediverse", canonical_url: `https://quiet.invalid/users/${randomUUID()}`, last_fetched_at: at.toISOString() });
    const active = await space({ adapter: "civic_hub", canonical_url: `https://quiet.invalid/${randomUUID()}`, newest_item_at: new Date(at.getTime() - 10 * DAY).toISOString(), last_fetched_at: at.toISOString() });
    const neverFetched = await space({ adapter: "civic_hub", canonical_url: `https://quiet.invalid/${randomUUID()}` });
    const sample = await space({ adapter: "sample", canonical_url: `https://quiet-sample.invalid/${randomUUID()}`, newest_item_at: old, last_fetched_at: at.toISOString() });
    const circle = await as(member, async (db) => {
      for (const id of [quiet, silent, active, neverFetched, sample]) {
        await db.query("INSERT INTO river.follows (space_id) VALUES ($1)", [id]);
      }
      return createCircle(db, { name: "Everything", color: "#123456" });
    });
    await as(member, (db) => addCircleMember(db, circle.id, quiet));

    const page = await as(member, (db) => followingPage(db, at));
    expect(new Set(page.quiet)).toEqual(new Set([quiet, silent]));
    expect(page.spaces.find((s) => s.id === sample)?.quiet).toBe(false);

    const gone = await as(member, (db) => unfollowQuiet(db, at));
    expect(new Set(gone)).toEqual(new Set([quiet, silent]));
    const after = await as(member, (db) => followingPage(db, at));
    expect(after.quiet).toEqual([]);
    expect(new Set(after.spaces.map((s) => s.id))).toEqual(new Set([active, neverFetched, sample]));
    // An unfollowed space leaves the member's circles too.
    expect(after.circles.find((c) => c.id === circle.id)?.spaceIds).toEqual([]);
  });
});

describe("circles (spec F8)", () => {
  it("create, rename, recolor and delete; a space in several circles; the civic circle keeps its role", async () => {
    const member = await newMember();
    const hub = await createHubSpace(river, FLOYD_FEED);
    await as(member, (db) => followPreview(db, previewOf(hub), { scope: "space", circleIds: [] }));
    const civic = await as(member, (db) => db.insert<{ id: string }>("circles", { name: "Civic", color: "#2F6FA8", role: "civic" }));

    const a = await as(member, (db) => createCircle(db, { name: "  Town  hall ", color: "#aa0000" }));
    expect(a).toMatchObject({ name: "Town hall", color: "#AA0000", role: null });
    const b = await as(member, (db) => createCircle(db, { name: "Weekly", color: "#00aa00" }));
    await expect(as(member, (db) => createCircle(db, { name: "town HALL", color: "#000000" }))).rejects.toMatchObject({ code: "name_taken" });
    await expect(as(member, (db) => createCircle(db, { name: "", color: "#000000" }))).rejects.toMatchObject({ code: "bad_name" });
    await expect(as(member, (db) => createCircle(db, { name: "X", color: "red" }))).rejects.toMatchObject({ code: "bad_color" });

    for (const c of [a, b, { id: civic.id }]) await as(member, (db) => addCircleMember(db, c.id, hub.id));
    const page = await as(member, (db) => followingPage(db, now));
    expect(new Set(page.spaces[0]!.circleIds)).toEqual(new Set([a.id, b.id, civic.id]));

    const renamed = await as(member, (db) => updateCircle(db, civic.id, { name: "Our town", color: "#111111" }));
    expect(renamed).toMatchObject({ name: "Our town", color: "#111111", role: "civic", spaceIds: [hub.id] });
    await expect(as(member, (db) => deleteCircle(db, civic.id))).rejects.toMatchObject({ code: "civic_circle" });

    await as(member, (db) => removeCircleMember(db, b.id, hub.id));
    await as(member, (db) => deleteCircle(db, a.id));
    const after = await as(member, (db) => followingPage(db, now));
    expect(after.circles.map((c) => [c.name, c.role, c.spaceIds])).toEqual([
      ["Our town", "civic", [hub.id]],
      ["Weekly", null, []],
    ]);

    // Only followed spaces go in circles.
    const unfollowed = await createHubSpace(river, FLOYD_FEED);
    await expect(as(member, (db) => addCircleMember(db, b.id, unfollowed.id))).rejects.toMatchObject({ code: "not_followed" });
  });
});

describe("check 27: one member can't touch another's follows, rules or circles", () => {
  it("every write by id finds nothing of the other member's", async () => {
    const owner = await newMember();
    const other = await newMember();
    const hub = await createHubSpace(river, FLOYD_FEED);
    const { ruleId } = await as(owner, (db) => followPreview(db, previewOf(hub, VOTE), { scope: "stream", circleIds: [] }));
    const circle = await as(owner, (db) => createCircle(db, { name: "Mine", color: "#123456" }));
    await as(owner, (db) => followPreview(db, previewOf(hub), { scope: "space", circleIds: [circle.id] }));

    // The circle id in a follow request only reaches the requester's own circles.
    await as(other, (db) => followPreview(db, previewOf(hub), { scope: "space", circleIds: [circle.id] }));
    await expect(as(other, (db) => removeRule(db, ruleId))).rejects.toMatchObject({ code: "unknown_rule" });
    await expect(as(other, (db) => updateCircle(db, circle.id, { name: "Theirs" }))).rejects.toMatchObject({ code: "unknown_circle" });
    await expect(as(other, (db) => deleteCircle(db, circle.id))).rejects.toMatchObject({ code: "unknown_circle" });
    await expect(as(other, (db) => addCircleMember(db, circle.id, hub.id))).rejects.toMatchObject({ code: "unknown_circle" });
    await as(other, (db) => unfollowSpace(db, hub.id));
    await as(other, (db) => unfollowQuiet(db, new Date(now.getTime() + 1000 * DAY)));

    const mine = await as(owner, (db) => followingPage(db, now));
    expect(mine.spaces.map((s) => [s.id, s.following])).toEqual([[hub.id, true]]);
    expect(mine.circles.map((c) => [c.name, c.spaceIds])).toEqual([["Mine", [hub.id]]]);
    const theirs = await as(other, (db) => followingPage(db, now));
    expect(theirs.spaces).toEqual([]);
    expect(theirs.circles).toEqual([]);
  });
});
