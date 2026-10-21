// Refresh on open (spec 4.5) against the local database as river_app, with recorded responses
// replayed through the real fetch guard: the claim (check 24), the response budget (check 20),
// withdrawn processes (check 33), and the stream bookkeeping the refresh writes.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { forAccount, forInstance } from "../../../src/db/context.js";
import { FetchError, type FetchGuard } from "../../../src/shared/fetch/index.js";
import { AdapterError, type Adapter, type NormalizedItem } from "../../../src/shared/items/index.js";
import { queryFeed } from "../../../src/river/feed/query.js";
import { clearResolveFailures, refreshFollowed, refreshSpaces } from "../../../src/river/feed/refresh.js";
import { findSpaces } from "../../../src/river/feed/spaces.js";
import { applyStreams, storeItems } from "../../../src/river/feed/store.js";
import { checkWithdrawnStreams } from "../../../src/river/feed/withdrawn.js";
import { CIVIC_HUB_FIXTURE_NOW } from "../../fixtures/civicHubClock.js";
import {
  DEMOSVILLE_FEED,
  LONGMONT_FEED,
  createHubSpace,
  replayGuard,
  spaceRow,
  until,
} from "./feedHelpers.js";
import { RIVER_URL, SEED_INSTANCE, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);
const now = CIVIC_HUB_FIXTURE_NOW;
const DAY = 24 * 60 * 60 * 1000;
const noWait = () => undefined;

beforeAll(async () => {
  await requireDatabase(river, "river_app");
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await river.end();
});

function item(sourceId: string, streamKey: string, publishedAt: Date, extra: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    sourceId,
    kind: "civic",
    publishedAt,
    streamKey,
    media: [],
    isFinalResult: false,
    hidden: false,
    raw: {},
    ...extra,
  };
}

async function itemsOf(spaceId: string) {
  return forInstance(
    SEED_INSTANCE,
    async (db) =>
      (
        await db.query<{ source_id: string; hidden: boolean; is_final_result: boolean; stream_key: string | null }>(
          "SELECT source_id, hidden, is_final_result, stream_key FROM river.items WHERE space_id = $1 ORDER BY source_id",
          [spaceId],
        )
      ).rows,
    river,
  );
}

describe("refresh: one fetch per space per 120 s (check 24)", () => {
  it("two opens within 120 s cause one upstream fetch", async () => {
    const space = await createHubSpace(river, DEMOSVILLE_FEED);
    const guard = replayGuard();

    const first = await refreshSpaces(SEED_INSTANCE, [space], { guard, now, source: river, waitUntil: noWait });
    expect(first.claimed).toEqual([space.id]);
    expect(first.finished).toEqual([space.id]);
    const fetched = guard.requests.length;
    // The first fetch: 90 days back, and the page is stored.
    expect(guard.requests[0]).toContain("since=2026-07-23T00%3A00%3A00.000Z");
    expect((await itemsOf(space.id)).length).toBeGreaterThan(0);

    const second = await refreshSpaces(SEED_INSTANCE, [await spaceRow(river, space.id)], {
      guard,
      now,
      source: river,
      waitUntil: noWait,
    });
    expect(second.claimed).toEqual([]);
    expect(guard.requests.length).toBe(fetched);

    const after = await spaceRow(river, space.id);
    expect(after.fetch_lock_until).toBeNull();
    expect(after.last_fetched_at).not.toBeNull();
    expect(after.fetch_status).toBe("ok");
  });

  it("two opens at the same moment: one claims, the other fetches nothing", async () => {
    const space = await createHubSpace(river, DEMOSVILLE_FEED);
    const guard = replayGuard();
    const deps = { guard, now, source: river, waitUntil: noWait };
    const [a, b] = await Promise.all([
      refreshSpaces(SEED_INSTANCE, [space], deps),
      refreshSpaces(SEED_INSTANCE, [space], deps),
    ]);
    expect([...a.claimed, ...b.claimed]).toEqual([space.id]);
    const single = replayGuard();
    await refreshSpaces(SEED_INSTANCE, [await createHubSpace(river, DEMOSVILLE_FEED)], { ...deps, guard: single });
    expect(guard.requests.length).toBe(single.requests.length);
  });

  it("a refresh after a first fetch asks from newest minus 14 days and keeps items on a 304", async () => {
    const space = await createHubSpace(river, DEMOSVILLE_FEED);
    const guard = replayGuard();
    await refreshSpaces(SEED_INSTANCE, [space], { guard, now, source: river, waitUntil: noWait });
    const stored = await itemsOf(space.id);
    // Let the claim statement see a fetch older than 120 s.
    await forInstance(
      SEED_INSTANCE,
      (db) => db.query("UPDATE river.spaces SET last_fetched_at = now() - interval '5 minutes' WHERE id = $1", [space.id]),
      river,
    );
    guard.requests.length = 0;
    const again = await refreshSpaces(SEED_INSTANCE, [await spaceRow(river, space.id)], {
      guard,
      now,
      source: river,
      waitUntil: noWait,
    });
    expect(again.claimed).toEqual([space.id]);
    // newest (2026-09-28T03:00:53.587Z) + 14 days back; the stored ETag earns a recorded 304.
    expect(guard.requests[0]).toContain("since=2026-09-28T03%3A00%3A53.587Z");
    expect(await itemsOf(space.id)).toEqual(stored);
    expect((await spaceRow(river, space.id)).fetch_status).toBe("ok");
  });
});

describe("refresh: the 6 s response budget (check 20)", () => {
  it("answers within 6.5 s with the other sources' items; the slow one gets a quiet note later", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fast = await createHubSpace(river, DEMOSVILLE_FEED);
    const slow = await createHubSpace(river, "https://slow-hub.example/events");
    const replay = replayGuard();
    // The slow host answers after 30 s, too late for the response, and the guard reports the
    // request as timed out.
    const guard: FetchGuard = {
      fetch: (url, init) =>
        url.startsWith("https://slow-hub.example/")
          ? new Promise((_, reject) => setTimeout(() => reject(new FetchError("timeout", "No answer")), 30_000))
          : replay.fetch(url, init),
    };
    const kept: Array<Promise<unknown>> = [];
    let answered = false;
    const response = refreshSpaces(SEED_INSTANCE, [fast, slow], {
      guard,
      now,
      source: river,
      waitUntil: (p) => kept.push(p),
    }).then((report) => {
      answered = true;
      return report;
    });

    // The fast hub finishes on real I/O while no fake time passes.
    await until(async () => (await spaceRow(river, fast.id)).last_fetched_at !== null);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toBe(true);

    const report = await response;
    expect(report.finished).toContain(fast.id);
    expect(report.pending).toEqual([slow.id]);
    expect(kept).toHaveLength(1);
    expect((await itemsOf(fast.id)).length).toBeGreaterThan(0);
    // Nothing waits on the slow source: it is still claimed, with no note yet.
    const meanwhile = await spaceRow(river, slow.id);
    expect(meanwhile.fetch_lock_until).not.toBeNull();
    expect(meanwhile.last_error).toBeNull();

    await vi.advanceTimersByTimeAsync(24_000);
    await kept[0];
    const later = await spaceRow(river, slow.id);
    expect(later.fetch_status).toBe("error");
    expect(later.last_error).toBe("We couldn't reach that address (timeout)");
    expect(later.error_count).toBe(1);
    expect(later.fetch_lock_until).toBeNull();
    expect(later.last_fetched_at).not.toBeNull();
  });
});

describe("withdrawn processes (check 33)", () => {
  const gone = "https://demosville.civic.social/process/proc_0000000000000000";

  it("hides a stream the hub no longer serves, found during refresh", async () => {
    const space = await createHubSpace(river, DEMOSVILLE_FEED);
    const old = new Date(now.getTime() - 30 * DAY);
    await forInstance(
      SEED_INSTANCE,
      async (db) => {
        await storeItems(db, space.id, [item(`${gone}#a`, gone, old), item(`${gone}#b`, gone, new Date(old.getTime() + 1000))]);
        await applyStreams(db, space.id, [item(`${gone}#a`, gone, old)], []);
      },
      river,
    );
    const visible = await forInstance(SEED_INSTANCE, (db) => queryFeed(db, { spaceIds: [space.id], streams: [] }, {}), river);
    expect(visible.items.filter((i) => i.streamKey === gone)).toHaveLength(2);

    const guard = replayGuard();
    await refreshSpaces(SEED_INSTANCE, [space], { guard, now, source: river, waitUntil: noWait });

    // The recorded probe answers an empty page with no `next`.
    expect(guard.requests.some((u) => u.includes("context=https%3A%2F%2Fdemosville.civic.social%2Fprocess%2Fproc_0000000000000000"))).toBe(true);
    const rows = await itemsOf(space.id);
    expect(rows.filter((r) => r.stream_key === gone).every((r) => r.hidden)).toBe(true);
    // The live stream from the same fetch was probed too and stays visible.
    expect(rows.some((r) => r.stream_key !== gone && !r.hidden)).toBe(true);
    const feed = await forInstance(SEED_INSTANCE, (db) => queryFeed(db, { spaceIds: [space.id], streams: [] }, {}), river);
    expect(feed.items.some((i) => i.streamKey === gone)).toBe(false);
    expect(feed.items.length).toBeGreaterThan(0);

    // At most once a day: the next refresh doesn't probe it again.
    const again = await checkWithdrawnStreams(await spaceRow(river, space.id), {
      instanceId: SEED_INSTANCE,
      guard,
      now: new Date(now.getTime() + 60_000),
      source: river,
    });
    expect(again.probed).toEqual([]);
  });

  it("keeps a stream whose probe is empty but carries next (Longmont, recorded)", async () => {
    const key = "https://longmont.civic.social/process/proc_61d1410393c7427e";
    const space = await createHubSpace(river, LONGMONT_FEED);
    const old = new Date(now.getTime() - 20 * DAY);
    await forInstance(
      SEED_INSTANCE,
      async (db) => {
        await storeItems(db, space.id, [item(`${key}#a`, key, old)]);
        await applyStreams(db, space.id, [item(`${key}#a`, key, old)], []);
      },
      river,
    );
    const report = await checkWithdrawnStreams(space, { instanceId: SEED_INSTANCE, guard: replayGuard(), now, source: river });
    expect(report).toEqual({ probed: [key], withdrawn: [] });
    expect((await itemsOf(space.id)).every((r) => !r.hidden)).toBe(true);
  });

  it("doesn't probe a stream with an item in the last 7 days", async () => {
    const key = "https://longmont.civic.social/process/proc_61d1410393c7427e";
    const space = await createHubSpace(river, LONGMONT_FEED);
    await forInstance(
      SEED_INSTANCE,
      async (db) => {
        const recent = item(`${key}#r`, key, new Date(now.getTime() - 2 * DAY));
        await storeItems(db, space.id, [recent]);
        await applyStreams(db, space.id, [recent], []);
      },
      river,
    );
    const report = await checkWithdrawnStreams(space, { instanceId: SEED_INSTANCE, guard: replayGuard(), now, source: river });
    expect(report.probed).toEqual([]);
  });
});

describe("followed names with no space yet", () => {
  // A stand-in adapter for names nobody else uses, so this test owns its spaces. The real
  // adapters' resolve is covered by their own fixture tests and by the API tests' first visit.
  function fakeAdapter(fail = false): Adapter & { resolved: string[]; fetched: string[] } {
    const resolved: string[] = [];
    const fetched: string[] = [];
    return {
      name: "civic_hub",
      resolved,
      fetched,
      accepts: (input) => input.startsWith("test-follow:"),
      async resolve(input) {
        resolved.push(input);
        if (fail) throw new AdapterError("unreachable", "We couldn't reach that address");
        return {
          adapter: "civic_hub",
          canonicalUrl: `https://refresh-test.invalid/${input.slice("test-follow:".length)}`,
          name: "<b>Resolved</b> space",
          feedUrl: "https://refresh-test.invalid/events",
          category: "civic",
          manifest: {},
        };
      },
      async fetchNew(space, ctx) {
        fetched.push(space.id);
        const items = [item(`${space.canonicalUrl}#1`, `${space.canonicalUrl}/process/p`, now)];
        await ctx.onPage?.(items);
        return { items, space: { newestItemAt: now, fetchStatus: "ok", lastError: null }, streams: [], notModified: false };
      },
    };
  }

  it("resolves, stores and refreshes a new followed name on the first open", async () => {
    clearResolveFailures();
    const adapter = fakeAdapter();
    const input = `test-follow:${randomUUID()}`;
    const deps = {
      guard: replayGuard(),
      now,
      source: river,
      waitUntil: noWait,
      adapterFor: (i: string) => (adapter.accepts(i) ? adapter : undefined),
      adapterNamed: () => adapter,
    };
    const report = await refreshFollowed(SEED_INSTANCE, [input], deps);
    expect(report.created).toHaveLength(1);
    expect(report.claimed).toEqual(report.created);
    expect(report.finished).toEqual(report.created);
    const created = await spaceRow(river, report.created[0] as string);
    expect(created.name).toBe("Resolved space");
    expect(created.newest_item_at?.toISOString()).toBe(now.toISOString());
    expect(await itemsOf(created.id)).toHaveLength(1);

    // Found by its canonical URL from now on: no second resolve.
    const found = await forInstance(SEED_INSTANCE, (db) => findSpaces(db, [created.canonical_url]), river);
    expect(found.get(created.canonical_url)?.id).toBe(created.id);
  });

  it("a name that won't resolve is retried only after a pause", async () => {
    clearResolveFailures();
    const adapter = fakeAdapter(true);
    const input = `test-follow:${randomUUID()}`;
    const deps = {
      guard: replayGuard(),
      now,
      source: river,
      waitUntil: noWait,
      adapterFor: (i: string) => (adapter.accepts(i) ? adapter : undefined),
    };
    const first = await refreshFollowed(SEED_INSTANCE, [input], deps);
    expect(first.unresolved).toEqual([{ input, reason: "We couldn't reach that address" }]);
    await refreshFollowed(SEED_INSTANCE, [input], deps);
    expect(adapter.resolved).toEqual([input]);
  });
});

describe("stream bookkeeping", () => {
  it("an ended stream moves every account's ends_with_stream follows to Ended", async () => {
    const space = await createHubSpace(river, DEMOSVILLE_FEED);
    const key = `https://refresh-test.invalid/process/proc_${randomUUID().slice(0, 8)}`;
    const t = new Date(now.getTime() - DAY);
    const accounts = await forInstance(
      SEED_INSTANCE,
      async (db) => {
        await storeItems(db, space.id, [item(`${key}#start`, key, t)]);
        await applyStreams(db, space.id, [item(`${key}#start`, key, t)], [{ key, title: "A process" }]);
        const a = await db.insert<{ id: string }>("accounts", { display_name: "A" });
        const b = await db.insert<{ id: string }>("accounts", { display_name: "B" });
        return [a.id, b.id];
      },
      river,
    );
    const streamId = await forInstance(
      SEED_INSTANCE,
      async (db) =>
        (await db.query<{ id: string; title: string }>("SELECT id, title FROM river.streams WHERE space_id = $1 AND key = $2", [space.id, key])).rows[0],
      river,
    );
    expect(streamId?.title).toBe("A process");
    for (const [i, account] of accounts.entries()) {
      await forAccount(
        SEED_INSTANCE,
        account,
        (db) => db.insert("follows", { space_id: space.id, stream_id: streamId?.id, ends_with_stream: i === 0 }),
        river,
      );
    }

    const endedAt = new Date(now.getTime() - 3600_000);
    await forInstance(
      SEED_INSTANCE,
      (db) => applyStreams(db, space.id, [], [{ key, status: "ended", endedAt }]),
      river,
    );

    const endedOf = (account: string) =>
      forAccount(
        SEED_INSTANCE,
        account,
        async (db) => (await db.query<{ ended_at: Date | null }>("SELECT ended_at FROM river.follows")).rows[0]?.ended_at,
        river,
      );
    expect((await endedOf(accounts[0] as string))?.toISOString()).toBe(endedAt.toISOString());
    // A follow that doesn't end with its stream keeps following.
    expect(await endedOf(accounts[1] as string)).toBeNull();
  });

  it("the final result moves only to a candidate at least as new", async () => {
    const space = await createHubSpace(river, DEMOSVILLE_FEED);
    const key = "https://refresh-test.invalid/process/proc_final";
    const t = now.getTime();
    await forInstance(
      SEED_INSTANCE,
      async (db) => {
        const end = item("end", key, new Date(t - 3000));
        const result = item("result", key, new Date(t - 1000));
        const stale = item("stale-outcome", key, new Date(t - 2000));
        await storeItems(db, space.id, [end, result, stale]);
        await applyStreams(db, space.id, [end], [{ key, status: "ended", endedAt: now, finalItemSourceId: "end" }]);
        await applyStreams(db, space.id, [result], [{ key, finalItemSourceId: "result" }]);
        // An older candidate from a later fetch doesn't take the flag back.
        await applyStreams(db, space.id, [stale], [{ key, finalItemSourceId: "stale-outcome" }]);
      },
      river,
    );
    const finals = (await itemsOf(space.id)).filter((r) => r.is_final_result).map((r) => r.source_id);
    expect(finals).toEqual(["result"]);
  });

  it("storing a page twice keeps one row per (space, source id)", async () => {
    const space = await createHubSpace(river, DEMOSVILLE_FEED);
    const page = [item("one", "k", now), item("two", "k", now)];
    await forInstance(SEED_INSTANCE, (db) => storeItems(db, space.id, page), river);
    await forInstance(SEED_INSTANCE, (db) => storeItems(db, space.id, [{ ...page[0]!, title: "Edited" }]), river);
    const rows = await itemsOf(space.id);
    expect(rows.map((r) => r.source_id)).toEqual(["one", "two"]);
  });
});
