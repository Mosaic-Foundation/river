// The Civic Hub adapter end to end over replayed responses: resolve (check 13 and 14's adapter
// half, refusals), paging (check 25) and stream end (check 18's adapter half). Recorded fixtures
// come from tests/fixtures/http/ (real responses from Demosville, Floyd and Longmont). Sequences the
// live hubs don't contain are DERIVED from recorded activities (ids and dates edited), built inline
// below and labelled; none of them is in the recorded folder.
import { describe, expect, it } from "vitest";
import {
  civicHubAdapter,
  firstFetchUrl,
  probeStream,
  refreshUrl,
  streamProbeUrl,
} from "../../../src/river/adapters/civicHub/index.js";
import { AdapterError, ADAPTER_MESSAGES, type NormalizedItem, type SpaceRecord } from "../../../src/shared/items/index.js";
import type { HttpFixture } from "../../../src/shared/fetch/index.js";
import { NOW, pageFixture, RECORDED, recorded, recordedActivity, replayGuard, type Activity } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;

function space(host: string, extra: Partial<SpaceRecord> = {}): SpaceRecord {
  return {
    id: `space-${host}`,
    adapter: "civic_hub",
    canonicalUrl: `https://${host}`,
    feedUrl: `https://${host}/events`,
    manifest: {},
    ...extra,
  };
}

async function rejection(promise: Promise<unknown>): Promise<AdapterError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AdapterError);
  return err as AdapterError;
}

function body(url: string): { orderedItems: Activity[]; next?: string } {
  return JSON.parse(recorded(url).body) as { orderedItems: Activity[]; next?: string };
}

describe("resolve", () => {
  it("check 13: Demosville previews its name, category civic and no icon (the UI draws initials)", async () => {
    const { guard, requests } = replayGuard();
    const preview = await civicHubAdapter.resolve("https://demosville.civic.social", { guard, now: NOW });
    expect(preview).toMatchObject({
      adapter: "civic_hub",
      canonicalUrl: "https://demosville.civic.social",
      homeUrl: "https://demosville.civic.social",
      name: "Demosville Civic Hub",
      category: "civic",
      feedUrl: "https://demosville.civic.social/events",
      manifest: { spaceId: "did:web:demosville.civic.social", spaceType: "civic.hub" },
    });
    expect(preview.iconUrl).toBeUndefined();
    expect(preview.stream).toBeUndefined();
    expect(requests.map((r) => r.url)).toEqual(["https://demosville.civic.social/.well-known/civic.json"]);
  });

  it("reads jurisdictions, and takes any URL or bare host on the hub", async () => {
    const { guard } = replayGuard();
    const floyd = await civicHubAdapter.resolve("floyd.civic.social/some/page", { guard, now: NOW });
    expect(floyd.name).toBe("Floyd Civic Hub");
    expect(floyd.manifest.jurisdictions).toEqual(["us-va-floyd"]);
    const longmont = await civicHubAdapter.resolve("  https://longmont.civic.social/  ", { guard, now: NOW });
    expect(longmont.manifest.jurisdictions).toEqual(["us-co-longmont-city"]);
  });

  it("check 14 (adapter half): a Longmont meeting-summary URL resolves to its /process/ stream key, validated", async () => {
    const { guard, requests } = replayGuard();
    const key = "https://longmont.civic.social/process/proc_4ebb11759c4c40ce";
    const preview = await civicHubAdapter.resolve("https://longmont.civic.social/meeting-summary/proc_4ebb11759c4c40ce", {
      guard,
      now: NOW,
    });
    expect(preview.stream?.key).toBe(key);
    expect(preview.canonicalUrl).toBe("https://longmont.civic.social");
    expect(requests.map((r) => r.url)).toEqual([
      "https://longmont.civic.social/.well-known/civic.json",
      streamProbeUrl("https://longmont.civic.social/events", key),
    ]);
    expect(requests[1].url).toContain("page=true");
    expect(requests[1].url).toContain("limit=1");
  });

  it("a stream whose newest event isn't public still validates: the hub answers an empty page with next (recorded)", async () => {
    const probe = RECORDED.find((f) => f.url.includes("context=") && /"orderedItems":\[\]/.test(f.body) && f.body.includes('"next"'));
    expect(probe, "an empty probe page with next is recorded").toBeDefined();
    const key = new URL(probe!.url).searchParams.get("context")!;
    const { guard } = replayGuard();
    const preview = await civicHubAdapter.resolve(key, { guard, now: NOW });
    expect(preview.stream?.key).toBe(key);
    expect(preview.stream?.title).toBeUndefined();
  });

  it("a process the hub doesn't serve isn't a Space we can follow (recorded empty page, no next)", async () => {
    const { guard } = replayGuard();
    const err = await rejection(
      civicHubAdapter.resolve("https://floyd.civic.social/process/proc_0000000000000000", { guard, now: NOW }),
    );
    expect(err.reason).toBe("not_a_space");
    expect(err.message).toBe(ADAPTER_MESSAGES.not_a_space);
    const probe = await probeStream("https://floyd.civic.social/events", "https://floyd.civic.social/process/proc_0000000000000000", {
      guard,
    });
    expect(probe.exists).toBe(false);
  });

  it('{"code":"no_hub"} is not a Space (DERIVED: the spec\'s answer; no non-hub host was reachable to record)', async () => {
    const noHub: HttpFixture = {
      url: "https://nohub.civic.social/.well-known/civic.json",
      status: 404,
      headers: { "content-type": "application/json" },
      body: '{"code":"no_hub"}',
    };
    const { guard } = replayGuard([noHub]);
    const err = await rejection(civicHubAdapter.resolve("https://nohub.civic.social/process/proc_1", { guard, now: NOW }));
    expect(err.reason).toBe("not_a_space");
  });

  it("a page that isn't a hub description is not a Space (DERIVED)", async () => {
    const cases: HttpFixture[] = [
      { url: "https://a.example/.well-known/civic.json", status: 404, headers: { "content-type": "text/html" }, body: "<h1>Not found</h1>" },
      { url: "https://b.example/.well-known/civic.json", status: 200, headers: {}, body: '{"name":"No space"}' },
      {
        url: "https://c.example/.well-known/civic.json",
        status: 200,
        headers: {},
        body: '{"name":"Bad feed","space":{"id":"did:web:c.example","type":"civic.hub"},"feeds":["http://c.example/events"]}',
      },
    ];
    const { guard } = replayGuard(cases);
    for (const host of ["a.example", "b.example", "c.example"]) {
      expect((await rejection(civicHubAdapter.resolve(`https://${host}`, { guard, now: NOW }))).reason, host).toBe("not_a_space");
    }
  });

  it("an https icon is used when a hub sends one (DERIVED: the spec's future field)", async () => {
    const real = JSON.parse(recorded("https://demosville.civic.social/.well-known/civic.json").body) as Record<string, unknown>;
    const fixture: HttpFixture = {
      url: "https://icon.example/.well-known/civic.json",
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...real, icon: "https://icon.example/icon.png" }),
    };
    const { guard } = replayGuard([fixture]);
    expect((await civicHubAdapter.resolve("https://icon.example", { guard, now: NOW })).iconUrl).toBe("https://icon.example/icon.png");
    const insecure = { ...fixture, url: "https://icon2.example/.well-known/civic.json", body: JSON.stringify({ ...real, icon: "javascript:alert(1)" }) };
    const second = replayGuard([insecure]);
    expect((await civicHubAdapter.resolve("https://icon2.example", { guard: second.guard, now: NOW })).iconUrl).toBeUndefined();
  });

  it("addresses the guard refuses are refused, with no request sent (check 16 through the adapter)", async () => {
    const { guard } = replayGuard();
    for (const input of ["http://example.org", "https://localhost", "https://127.0.0.1", "https://10.0.0.5", "https://169.254.169.254", "https://[::1]"]) {
      const err = await rejection(civicHubAdapter.resolve(input, { guard, now: NOW }));
      expect(err.reason, input).toBe("refused");
      expect(err.message, input).toContain(ADAPTER_MESSAGES.refused);
    }
  });

  it("a host that doesn't resolve is unreachable", async () => {
    const { guard } = replayGuard();
    expect((await rejection(civicHubAdapter.resolve("https://nowhere.example", { guard, now: NOW }))).reason).toBe("unreachable");
  });

  it("accepts URLs and hosts, not fediverse handles or profile URLs", () => {
    for (const input of ["https://floyd.civic.social", "floyd.civic.social", "longmont.civic.social/meeting-summary/proc_1", "http://example.org"]) {
      expect(civicHubAdapter.accepts(input), input).toBe(true);
    }
    for (const input of ["@w3c@w3c.social", "w3c@w3c.social", "https://w3c.social/@w3c", "", "not a url", "ftp://x.example", "floyd"]) {
      expect(civicHubAdapter.accepts(input), input).toBe(false);
    }
  });
});

describe("check 25: hub paging", () => {
  it("first fetch sends since = now − 90 days, limit 50, follows next, and stops at 5 pages (recorded Floyd)", async () => {
    const { guard, requests } = replayGuard();
    const pages: NormalizedItem[][] = [];
    const result = await civicHubAdapter.fetchNew(space("floyd.civic.social"), { guard, now: NOW, onPage: (p) => void pages.push(p) });

    const first = firstFetchUrl("https://floyd.civic.social/events", NOW);
    expect(first).toBe("https://floyd.civic.social/events?page=true&limit=50&since=2026-07-23T00%3A00%3A00.000Z");
    expect(new Date(new URL(first).searchParams.get("since")!).getTime()).toBe(NOW.getTime() - 90 * DAY);
    expect(requests[0]).toEqual({ url: first, headers: expect.not.objectContaining({ "if-none-match": expect.anything() }) });
    expect(requests).toHaveLength(5);
    // Each request after the first is the previous page's `next`.
    for (let i = 1; i < requests.length; i++) expect(requests[i].url).toBe(body(requests[i - 1].url).next);
    // The fifth page still has a next; the cap stopped there.
    expect(body(requests[4].url).next).toBeTruthy();

    expect(pages).toHaveLength(5);
    expect(pages.flat().map((i) => i.sourceId)).toEqual(result.items.map((i) => i.sourceId));
    expect(result.notModified).toBe(false);
    expect(result.space.fetchStatus).toBe("ok");
    expect(result.space.etag).toBe(recorded(first).headers.etag);
    expect(result.space.etagUrl).toBe(first);
    const newest = Math.max(...result.items.map((i) => i.publishedAt.getTime()));
    expect(result.space.newestItemAt?.getTime()).toBe(newest);
    expect(new Set(result.items.map((i) => i.sourceId)).size).toBe(result.items.length);
    // Shown and hidden items both arrive; hidden ones are stored, not dropped.
    expect(result.items.some((i) => i.hidden)).toBe(true);
    expect(result.items.some((i) => !i.hidden)).toBe(true);
  });

  it("a short page with next is followed (recorded Longmont: fewer than 50 items, then a second page)", async () => {
    const { guard, requests } = replayGuard();
    const first = firstFetchUrl("https://longmont.civic.social/events", NOW);
    const firstPage = body(first);
    expect(firstPage.orderedItems.length).toBeLessThan(50);
    expect(firstPage.next).toBeTruthy();
    const result = await civicHubAdapter.fetchNew(space("longmont.civic.social"), { guard, now: NOW });
    expect(requests.map((r) => r.url)).toEqual([first, firstPage.next]);
    expect(body(firstPage.next!).next).toBeUndefined();
    expect(result.items.length).toBeGreaterThan(firstPage.orderedItems.length);
  });

  it("a single page with no next is one request (recorded Demosville)", async () => {
    const { guard, requests } = replayGuard();
    const result = await civicHubAdapter.fetchNew(space("demosville.civic.social"), { guard, now: NOW });
    expect(requests).toHaveLength(1);
    expect(result.items.map((i) => i.civic?.label)).toEqual(["A process proposed", "A process opened"]);
  });

  it("refresh sends since = newest − 14 days and no If-None-Match when the stored ETag is for another URL", async () => {
    const { guard } = replayGuard();
    const first = await civicHubAdapter.fetchNew(space("floyd.civic.social"), { guard, now: NOW });
    const newest = first.space.newestItemAt!;

    const replay = replayGuard();
    const stored = space("floyd.civic.social", { newestItemAt: newest, etag: first.space.etag, etagUrl: first.space.etagUrl });
    const result = await civicHubAdapter.fetchNew(stored, { guard: replay.guard, now: NOW });
    const url = refreshUrl("https://floyd.civic.social/events", newest);
    expect(new Date(new URL(url).searchParams.get("since")!).getTime()).toBe(newest.getTime() - 14 * DAY);
    expect(replay.requests[0].url).toBe(url);
    expect(replay.requests[0].headers["if-none-match"]).toBeUndefined();
    expect(replay.requests.length).toBeLessThanOrEqual(3);
    expect(result.notModified).toBe(false);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.space.etagUrl).toBe(url);
  });

  it("refresh sends If-None-Match for the same URL, and the hub's 304 keeps existing items (recorded 304s)", async () => {
    for (const host of ["demosville.civic.social", "floyd.civic.social", "longmont.civic.social"]) {
      const conditional = RECORDED.find((f) => new URL(f.url).host === host && f.requestHeaders?.["if-none-match"]);
      expect(conditional, host).toBeDefined();
      expect(conditional!.status).toBe(304);
      const since = new Date(new URL(conditional!.url).searchParams.get("since")!);
      const newestItemAt = new Date(since.getTime() + 14 * DAY);
      const { guard, requests } = replayGuard();
      const pages: NormalizedItem[][] = [];
      const result = await civicHubAdapter.fetchNew(
        space(host, { newestItemAt, etag: conditional!.requestHeaders!["if-none-match"], etagUrl: conditional!.url }),
        { guard, now: NOW, onPage: (p) => void pages.push(p) },
      );
      expect(requests).toHaveLength(1);
      expect(requests[0].headers["if-none-match"]).toBe(conditional!.requestHeaders!["if-none-match"]);
      expect(result).toEqual({ items: [], space: { fetchStatus: "ok", lastError: null }, streams: [], notModified: true });
      expect(pages).toEqual([]);
    }
  });

  it("refresh stops at 3 pages (DERIVED: four linked pages of recorded activities)", async () => {
    const acts = [
      recordedActivity("Create", "civic:Process", "civic.vote")!,
      recordedActivity("civic:Start", "civic:Process", "civic.vote")!,
      recordedActivity("Create", "civic:Proposal")!,
      recordedActivity("Create", "hub:Project")!,
    ];
    const newestItemAt = new Date("2026-10-10T00:00:00.000Z");
    const first = refreshUrl("https://derived.example/events", newestItemAt);
    const urls = [first, ...[2, 3, 4].map((n) => `https://derived.example/events?page=true&cursor=c${n}`)];
    const fixtures = urls.map((url, i) =>
      pageFixture(url, [{ ...acts[i], id: `https://derived.example/activities/evt_${i}` }], urls[i + 1] ? { next: urls[i + 1] } : {}),
    );
    const { guard, requests } = replayGuard(fixtures);
    const result = await civicHubAdapter.fetchNew(space("derived.example", { newestItemAt }), { guard, now: NOW });
    expect(requests.map((r) => r.url)).toEqual(urls.slice(0, 3));
    expect(result.items).toHaveLength(3);
  });

  it("never follows next to another origin or back to a page already read (DERIVED)", async () => {
    const act = recordedActivity("Create", "civic:Process")!;
    const first = firstFetchUrl("https://derived.example/events", NOW);
    const fixtures = [
      pageFixture(first, [act], { next: "https://elsewhere.example/events?page=2" }),
      pageFixture(firstFetchUrl("https://loop.example/events", NOW), [act], { next: firstFetchUrl("https://loop.example/events", NOW) }),
    ];
    const one = replayGuard(fixtures);
    await civicHubAdapter.fetchNew(space("derived.example"), { guard: one.guard, now: NOW });
    expect(one.requests).toHaveLength(1);
    const two = replayGuard(fixtures);
    await civicHubAdapter.fetchNew(space("loop.example"), { guard: two.guard, now: NOW });
    expect(two.requests).toHaveLength(1);
  });

  it("a failed later page keeps the pages that arrived and reports the error (DERIVED)", async () => {
    const act = recordedActivity("Create", "civic:Process")!;
    const first = firstFetchUrl("https://derived.example/events", NOW);
    const second = "https://derived.example/events?page=true&cursor=x";
    const fixtures: HttpFixture[] = [
      pageFixture(first, [act], { next: second }),
      { url: second, status: 500, headers: {}, body: "oops" },
    ];
    const { guard } = replayGuard(fixtures);
    const pages: NormalizedItem[][] = [];
    const result = await civicHubAdapter.fetchNew(space("derived.example"), { guard, now: NOW, onPage: (p) => void pages.push(p) });
    expect(pages).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result.space.fetchStatus).toBe("error");
    expect(result.space.lastError).toContain("HTTP 500");
  });

  it("a failed first page is an AdapterError for the caller to record (DERIVED)", async () => {
    const fixtures: HttpFixture[] = [{ url: firstFetchUrl("https://derived.example/events", NOW), status: 503, headers: {}, body: "" }];
    const { guard } = replayGuard(fixtures);
    expect((await rejection(civicHubAdapter.fetchNew(space("derived.example"), { guard, now: NOW }))).reason).toBe("unreachable");
  });
});

describe("check 18 (adapter half): stream end", () => {
  const VOTE = "https://floyd.civic.social/process/proc_beta_vote_energy_001";

  it("recorded Floyd vote: End, then Aggregation, then Result all arrive; the Result is the final result; the stream ends", async () => {
    const { guard } = replayGuard();
    const result = await civicHubAdapter.fetchNew(space("floyd.civic.social"), { guard, now: NOW });
    const stream = result.items.filter((i) => i.streamKey === VOTE && !i.hidden);
    const end = stream.find((i) => i.civic?.activityType === "civic:End")!;
    const aggregation = stream.find((i) => i.civic?.objectType === "hub:Aggregation")!;
    const outcome = stream.find((i) => i.civic?.activityType === "Announce" && i.civic.objectType === "civic:Result")!;
    expect(end && aggregation && outcome).toBeTruthy();
    expect(end.publishedAt < aggregation.publishedAt && aggregation.publishedAt < outcome.publishedAt).toBe(true);

    expect(stream.filter((i) => i.isFinalResult).map((i) => i.sourceId)).toEqual([outcome.sourceId]);
    expect(result.items.filter((i) => i.streamKey === VOTE && i.isFinalResult)).toHaveLength(1);
    const update = result.streams.find((s) => s.key === VOTE)!;
    expect(update).toMatchObject({ status: "ended", endedAt: NOW, finalItemSourceId: outcome.sourceId });
    expect(aggregation.summary).toMatch(/people took part/);
  });

  it("streams carry their title from Create civic:Process, and only streams with news get an update", async () => {
    const { guard } = replayGuard();
    const result = await civicHubAdapter.fetchNew(space("demosville.civic.social"), { guard, now: NOW });
    expect(result.streams).toEqual([
      { key: "https://demosville.civic.social/process/proc_65384a6859204b65", title: "Audit 3 Vote" },
    ]);
    // The Offer has no name of its own; it takes the stream's title from the same page.
    expect(result.items.map((i) => i.title)).toEqual(["Audit 3 Vote", "Audit 3 Vote"]);
  });

  it("across fetches: the End alone is final at first, then the Result that follows takes over (DERIVED)", async () => {
    // Derived from the recorded Floyd vote: the same three activities, on a test host, with the
    // End arriving in one fetch and the Aggregation and Result in the next refresh.
    const host = "derived-vote.example";
    const key = `https://${host}/process/proc_00ab`;
    const retarget = (a: Activity, id: string, published: string): Activity => ({
      ...a,
      id: `https://${host}/activities/${id}`,
      published,
      context: { ...a.context, id: key },
      url: key,
    });
    const end = retarget(recordedActivity("civic:End", "civic:Process", "civic.vote")!, "evt_end", "2026-10-15T10:00:00.000Z");
    const agg = retarget(recordedActivity("Create", "hub:Aggregation", "civic.vote")!, "evt_agg", "2026-10-15T10:00:01.000Z");
    const res = retarget(recordedActivity("Announce", "civic:Result", "civic.vote")!, "evt_res", "2026-10-16T09:00:00.000Z");

    const firstUrl = firstFetchUrl(`https://${host}/events`, NOW);
    const one = replayGuard([pageFixture(firstUrl, [end])]);
    const fetch1 = await civicHubAdapter.fetchNew(space(host), { guard: one.guard, now: NOW });
    expect(fetch1.streams).toEqual([{ key, status: "ended", endedAt: NOW, finalItemSourceId: end.id }]);
    expect(fetch1.items[0].isFinalResult).toBe(true);

    const later = new Date(NOW.getTime() + DAY);
    const newestItemAt = fetch1.space.newestItemAt!;
    const two = replayGuard([pageFixture(refreshUrl(`https://${host}/events`, newestItemAt), [res, agg, end])]);
    const fetch2 = await civicHubAdapter.fetchNew(space(host, { newestItemAt }), { guard: two.guard, now: later });
    expect(fetch2.items.map((i) => [i.sourceId, i.isFinalResult])).toEqual([
      [res.id, true],
      [agg.id, false],
      [end.id, false],
    ]);
    expect(fetch2.streams).toEqual([{ key, status: "ended", endedAt: later, finalItemSourceId: res.id }]);
  });

  it("a final-result candidate with no End in the fetch still names the final item (recorded Floyd briefs)", async () => {
    const { guard } = replayGuard();
    const result = await civicHubAdapter.fetchNew(space("floyd.civic.social"), { guard, now: NOW });
    const briefResult = result.items.find((i) => i.civic?.processType === "civic.brief" && i.civic.objectType === "civic:Result")!;
    expect(briefResult.isFinalResult).toBe(true);
    const update = result.streams.find((s) => s.key === briefResult.streamKey)!;
    expect(update.finalItemSourceId).toBe(briefResult.sourceId);
    expect(update.status).toBeUndefined();
  });
});
