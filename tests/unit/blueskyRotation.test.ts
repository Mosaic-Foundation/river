// Which Bluesky spaces a feed open refreshes (src/river/feed/rotation.ts; docs/spec/bluesky-1.md
// item 4; DECISIONS.md "Refreshing hundreds of Bluesky accounts"): a capped, rotating subset,
// most recent posters first, with a share for accounts just imported. Other adapters are untouched.
import { describe, expect, it } from "vitest";
import {
  BLUESKY_REFRESH_CAP,
  chooseForRefresh,
  isDue,
  NEW_SHARE,
  refreshInterval,
} from "../../src/river/feed/rotation.js";

const NOW = Date.parse("2026-10-23T18:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface Row {
  id: string;
  adapter: "atproto" | "fediverse" | "civic_hub";
  newest_item_at: Date | null;
  last_fetched_at: Date | null;
}

function bsky(id: string, postedAgo: number | null, fetchedAgo: number | null): Row {
  return {
    id,
    adapter: "atproto",
    newest_item_at: postedAgo === null ? null : new Date(NOW - postedAgo),
    last_fetched_at: fetchedAgo === null ? null : new Date(NOW - fetchedAgo),
  };
}

describe("refreshInterval and isDue", () => {
  it("waits longer for quieter accounts: 2 min, 15 min, 1 h, 6 h", () => {
    expect(refreshInterval(new Date(NOW - HOUR), NOW)).toBe(2 * MIN);
    expect(refreshInterval(new Date(NOW - 3 * DAY), NOW)).toBe(15 * MIN);
    expect(refreshInterval(new Date(NOW - 20 * DAY), NOW)).toBe(HOUR);
    expect(refreshInterval(new Date(NOW - 60 * DAY), NOW)).toBe(6 * HOUR);
    expect(refreshInterval(null, NOW)).toBe(6 * HOUR);
  });

  it("a never-fetched space is due; a fetched one when its interval has passed", () => {
    expect(isDue(bsky("a", null, null), NOW)).toBe(true);
    expect(isDue(bsky("a", HOUR, MIN), NOW)).toBe(false);
    expect(isDue(bsky("a", HOUR, 3 * MIN), NOW)).toBe(true);
    expect(isDue(bsky("a", 60 * DAY, 2 * HOUR), NOW)).toBe(false);
    expect(isDue(bsky("a", 60 * DAY, 7 * HOUR), NOW)).toBe(true);
  });
});

describe("chooseForRefresh", () => {
  it("passes every other space through untouched", () => {
    const others: Row[] = [
      { id: "hub", adapter: "civic_hub", newest_item_at: null, last_fetched_at: new Date(NOW) },
      { id: "fedi", adapter: "fediverse", newest_item_at: null, last_fetched_at: null },
    ];
    expect(chooseForRefresh(others, NOW).map((r) => r.id)).toEqual(["hub", "fedi"]);
  });

  it("refreshes at most the cap of hundreds, the most overdue first, recent posters on a tie", () => {
    // 300 accounts fetched 10 minutes ago that all posted within the day (2-minute interval):
    // equally overdue, so the most recent posters go first.
    const rows = Array.from({ length: 300 }, (_, i) => bsky(`b${i}`, (i + 1) * MIN, 10 * MIN));
    const chosen = chooseForRefresh(rows, NOW);
    expect(chosen).toHaveLength(BLUESKY_REFRESH_CAP);
    expect(chosen.map((r) => r.id)).toEqual(rows.slice(0, BLUESKY_REFRESH_CAP).map((r) => r.id));
    // One that waited longer than its interval asks for comes before them.
    const waited = bsky("waited", 3 * DAY, 2 * HOUR);
    expect(chooseForRefresh([...rows, waited], NOW)[0]?.id).toBe("waited");
  });

  it("reaches every account of a large import over the following opens, busy ones more often", () => {
    // 300 accounts fetched once, an hour ago; half posted within the day, half within the week.
    let rows = Array.from({ length: 300 }, (_, i) => bsky(`b${i}`, i < 150 ? (i + 1) * MIN : 2 * DAY, HOUR));
    const refreshed = new Map<string, number>();
    // One open every 10 minutes for 10 hours, no new posts.
    for (let open = 0; open < 60; open++) {
      const at = NOW + open * 10 * MIN;
      const chosen = new Set(chooseForRefresh(rows, at).map((r) => r.id));
      for (const id of chosen) refreshed.set(id, (refreshed.get(id) ?? 0) + 1);
      rows = rows.map((r) => (chosen.has(r.id) ? { ...r, last_fetched_at: new Date(at) } : r));
    }
    expect(refreshed.size).toBe(300);
    const busy = rows.slice(0, 150).reduce((n, r) => n + (refreshed.get(r.id) ?? 0), 0);
    const quieter = rows.slice(150).reduce((n, r) => n + (refreshed.get(r.id) ?? 0), 0);
    expect(busy).toBeGreaterThan(quieter);
  });

  it("rotates: what was just refreshed waits, so the next open reaches the next ones", () => {
    const rows = Array.from({ length: 40 }, (_, i) => bsky(`b${i}`, 2 * DAY + i * MIN, 20 * MIN));
    const first = chooseForRefresh(rows, NOW);
    const after = rows.map((r) => (first.includes(r) ? { ...r, last_fetched_at: new Date(NOW) } : r));
    const second = chooseForRefresh(after, NOW + MIN);
    expect(second).toHaveLength(BLUESKY_REFRESH_CAP);
    expect(second.some((r) => first.some((f) => f.id === r.id))).toBe(false);
    expect(second[0]?.id).toBe(`b${BLUESKY_REFRESH_CAP}`);
  });

  it("gives just-imported accounts a share without starving active ones; spare slots go either way", () => {
    const active = Array.from({ length: 20 }, (_, i) => bsky(`active${i}`, HOUR, 5 * MIN));
    const imported = Array.from({ length: 200 }, (_, i) => bsky(`new${i}`, null, null));
    const chosen = chooseForRefresh([...imported, ...active], NOW);
    expect(chosen).toHaveLength(BLUESKY_REFRESH_CAP);
    expect(chosen.filter((r) => r.id.startsWith("new"))).toHaveLength(NEW_SHARE);
    expect(chosen.filter((r) => r.id.startsWith("new")).map((r) => r.id)).toEqual(["new0", "new1", "new2", "new3"]);

    // Only imported accounts: all the slots go to them.
    expect(chooseForRefresh(imported, NOW)).toHaveLength(BLUESKY_REFRESH_CAP);
    // Two active ones: the rest of the slots go to the imported ones.
    const few = chooseForRefresh([...imported, ...active.slice(0, 2)], NOW);
    expect(few).toHaveLength(BLUESKY_REFRESH_CAP);
    expect(few.filter((r) => r.id.startsWith("active"))).toHaveLength(2);
  });

  it("skips accounts not yet due, and returns none when none is", () => {
    const rows = Array.from({ length: 30 }, (_, i) => bsky(`b${i}`, HOUR, 30 * 1000));
    expect(chooseForRefresh(rows, NOW)).toEqual([]);
  });
});
