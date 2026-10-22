// M12 "Real media" end to end through the adapters and the real fetch guard, on the SYNTHETIC
// fixtures in tests/fixtures/http/synthetic-tube.example and synthetic-podcast.example (written to
// the published formats by scripts/synthetic-media-fixtures.ts; see TESTING.md): a PeerTube
// channel through the fediverse adapter, and a podcast feed through the feed adapter, by feed URL
// and by its home page. Responses marked DERIVED are test-only variants built here. No network.
import { describe, expect, it } from "vitest";
import { fediverseAdapter, OWN_VIDEO_LIMIT } from "../../src/river/adapters/fediverse/index.js";
import { ITEM_WINDOW_DAYS, rssAdapter } from "../../src/river/adapters/rss/index.js";
import { previewView, resolveInput } from "../../src/river/following/resolve.js";
import { AdapterError, type FetchContext, type NormalizedItem, type SpacePreview, type SpaceRecord } from "../../src/shared/items/index.js";
import { derived, NOW, recordedFixtures, recordedJson, replayGuard, type ReplayGuard } from "./helpers/fediverseFixtures.js";

type Json = Record<string, unknown>;

const TUBE = "https://synthetic-tube.example";
const CHANNEL = `${TUBE}/video-channels/trail_films`;
const OUTBOX_PAGE = `${CHANNEL}/outbox?page=1`;
const RIDGE = `${TUBE}/videos/watch/5f0c2a8e-3b7d-4c1e-9a62-1d4e8b7f0a31`;
const CREEK = `${TUBE}/videos/watch/8a41d6f2-0c9b-4e57-b3a8-6f2e1c9d4b72`;
const PODCAST = "https://synthetic-podcast.example";
const FEED = `${PODCAST}/feed.xml`;
const ETAG = '"syn-ep3-20261020"';

function spaceFrom(preview: SpacePreview, extra: Partial<SpaceRecord> = {}): SpaceRecord {
  return {
    id: "space-1",
    adapter: preview.adapter,
    canonicalUrl: preview.canonicalUrl,
    feedUrl: preview.feedUrl ?? null,
    actorId: preview.actorId ?? null,
    network: preview.network ?? null,
    manifest: preview.manifest,
    ...extra,
  };
}

/** The synthetic feed's 200 body (the same URL also has a 304 for If-None-Match). */
function feedBody(): string {
  const fixture = recordedFixtures().find((f) => f.url === FEED && f.status === 200);
  if (!fixture) throw new Error("no synthetic feed fixture");
  return fixture.body;
}

function ctx(replay: ReplayGuard, extra: Partial<FetchContext> = {}): FetchContext {
  return { guard: replay.guard, now: NOW, isKnown: () => false, ...extra };
}

async function rejection(promise: Promise<unknown>): Promise<AdapterError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AdapterError) return err;
    throw err;
  }
  throw new Error("expected an AdapterError");
}

describe("a PeerTube channel through the fediverse adapter (SYNTHETIC fixtures)", () => {
  it("resolves the handle to a video space: name, avatar, kind PeerTube channel", async () => {
    const replay = replayGuard();
    const preview = await resolveInput("@trail_films@synthetic-tube.example", { guard: replay.guard, now: NOW });
    expect(preview).toMatchObject({
      adapter: "fediverse",
      canonicalUrl: CHANNEL,
      actorId: CHANNEL,
      feedUrl: `${CHANNEL}/outbox`,
      network: "peertube",
      category: "video",
      name: "Synthetic Trail Films",
      iconUrl: `${TUBE}/lazy-static/avatars/trail_films-48.png`,
    });
    expect(previewView(preview)).toMatchObject({ kind: "PeerTube channel", address: "@trail_films@synthetic-tube.example" });
  });

  it("resolves the channel's URL too (the hub adapter is asked first and says no)", async () => {
    const replay = replayGuard();
    const preview = await resolveInput(CHANNEL, { guard: replay.guard, now: NOW });
    expect(preview).toMatchObject({ adapter: "fediverse", canonicalUrl: CHANNEL, category: "video" });
    expect(replay.calls[0]).toBe(`GET ${TUBE}/.well-known/civic.json`);
  });

  it("reads each announced video as a video item: title, duration, thumbnail, watch page", async () => {
    const replay = replayGuard();
    const preview = await fediverseAdapter.resolve("@trail_films@synthetic-tube.example", { guard: replay.guard, now: NOW });
    const pages: NormalizedItem[][] = [];
    const result = await fediverseAdapter.fetchNew(spaceFrom(preview), ctx(replay, { onPage: (items) => void pages.push(items) }));

    expect(result.space.fetchStatus).toBe("ok");
    expect(result.items.map((i) => [i.kind, i.title])).toEqual([
      ["video", "Ridge line at dawn"],
      ["video", "Creek crossing after the storm"],
      ["video", "Trail maintenance day"],
    ]);
    const [ridge, creek, maintenance] = result.items;
    expect(ridge).toMatchObject({
      // Keyed by the Announce, so the next refresh stops at it.
      sourceId: `${RIDGE}/announces/7`,
      url: `${TUBE}/w/cXqH7r2Lw9TzP4mV1nBk3s`,
      publishedAt: new Date("2026-10-19T15:00:00.000Z"),
      hidden: false,
      author: { name: "Synthetic Trail Films", handle: "@trail_films@synthetic-tube.example" },
    });
    expect(ridge!.boostOf).toBeUndefined();
    expect(ridge!.media).toEqual([
      { type: "video", url: `${TUBE}/static/web-videos/5f0c2a8e-3b7d-4c1e-9a62-1d4e8b7f0a31-720.mp4`, duration: 273 },
      { type: "image", url: `${TUBE}/lazy-static/previews/5f0c2a8e-3b7d-4c1e-9a62-1d4e8b7f0a31.jpg`, width: 850, height: 480 },
    ]);
    // HLS only: the file comes from the playlist's tag.
    expect(creek!.media[0]).toEqual({
      type: "video",
      url: `${TUBE}/static/streaming-playlists/hls/8a41d6f2-0c9b-4e57-b3a8-6f2e1c9d4b72/8a41d6f2-0c9b-4e57-b3a8-6f2e1c9d4b72-720-fragmented.mp4`,
      duration: 725,
    });
    expect(maintenance!.media[0]?.duration).toBe(3723);
    // The Markdown description is text in paragraphs, never markup.
    expect(ridge!.contentHtml).toBe(
      "<p>A slow climb to the east ridge before sunrise.</p><p>Filmed on a **handheld** camera; no drones.</p>",
    );
    expect(pages.flat()).toEqual(result.items);
    expect(replay.calls.filter((c) => c.includes("/videos/watch/"))).toHaveLength(3);
  });

  it("stops at the first known share and fetches no video for it", async () => {
    const replay = replayGuard();
    const preview = await fediverseAdapter.resolve("@trail_films@synthetic-tube.example", { guard: replay.guard, now: NOW });
    const before = replay.calls.length;
    const result = await fediverseAdapter.fetchNew(
      spaceFrom(preview),
      ctx(replay, { isKnown: (id) => id === `${CREEK}/announces/7` }),
    );
    expect(result.items.map((i) => i.title)).toEqual(["Ridge line at dawn"]);
    expect(replay.calls.slice(before).filter((c) => c.includes("/videos/watch/"))).toEqual([`GET ${RIDGE}`]);
  });

  it("reads a video that isn't the channel's own as a boost of it (DERIVED: other attributedTo)", async () => {
    const video = recordedJson<Json>(RIDGE);
    const other = derived(RIDGE, {
      body: { ...video, attributedTo: [{ type: "Group", id: `${TUBE}/video-channels/someone_else` }] },
    });
    const replay = replayGuard([other]);
    const preview = await fediverseAdapter.resolve("@trail_films@synthetic-tube.example", { guard: replay.guard, now: NOW });
    const result = await fediverseAdapter.fetchNew(spaceFrom(preview), ctx(replay));
    expect(result.items[0]).toMatchObject({
      kind: "video",
      title: "Ridge line at dawn",
      boostOf: { objectId: RIDGE, host: "synthetic-tube.example", author: { url: `${TUBE}/video-channels/someone_else` } },
    });
    expect(result.items[1]).toMatchObject({ kind: "video", title: "Creek crossing after the storm" });
  });

  it("keeps a boost card when the video can't be read (DERIVED: 404)", async () => {
    const replay = replayGuard([derived(RIDGE, { status: 404, body: "" })]);
    const preview = await fediverseAdapter.resolve("@trail_films@synthetic-tube.example", { guard: replay.guard, now: NOW });
    const result = await fediverseAdapter.fetchNew(spaceFrom(preview), ctx(replay));
    expect(result.space.fetchStatus).toBe("ok");
    expect(result.items[0]).toMatchObject({ boostOf: { objectId: RIDGE } });
  });

  it(`fetches at most ${OWN_VIDEO_LIMIT} videos per refresh (DERIVED: a page of 25 shares)`, async () => {
    const page = recordedJson<Json & { orderedItems: Json[] }>(OUTBOX_PAGE);
    const share = page.orderedItems[0] as Json;
    const many = Array.from({ length: 25 }, (_, n) => ({ ...share, id: `${RIDGE}/announces/${100 + n}` }));
    const replay = replayGuard([derived(OUTBOX_PAGE, { body: { ...page, orderedItems: many } })]);
    const preview = await fediverseAdapter.resolve("@trail_films@synthetic-tube.example", { guard: replay.guard, now: NOW });
    const before = replay.calls.length;
    const result = await fediverseAdapter.fetchNew(spaceFrom(preview), ctx(replay));
    expect(result.items).toHaveLength(25);
    expect(result.items.filter((i) => i.kind === "video")).toHaveLength(OWN_VIDEO_LIMIT);
    expect(replay.calls.slice(before).filter((c) => c.includes("/videos/watch/"))).toHaveLength(OWN_VIDEO_LIMIT);
  });

  it("outside PeerTube, a channel's shares are boosts: filled with the video, still boosts", async () => {
    const replay = replayGuard();
    const preview = await fediverseAdapter.resolve("@trail_films@synthetic-tube.example", { guard: replay.guard, now: NOW });
    const result = await fediverseAdapter.fetchNew(spaceFrom(preview, { network: "mastodon" }), ctx(replay));
    expect(result.items.every((i) => i.boostOf !== undefined)).toBe(true);
    expect(result.items[0]).toMatchObject({ kind: "video", title: "Ridge line at dawn", boostOf: { objectId: RIDGE } });
  });
});

describe("a podcast feed through the feed adapter (SYNTHETIC fixtures)", () => {
  it("resolves the feed URL: name, cover art, kind Podcast feed", async () => {
    const replay = replayGuard();
    const preview = await resolveInput(FEED, { guard: replay.guard, now: NOW });
    expect(preview).toMatchObject({
      adapter: "rss",
      canonicalUrl: FEED,
      feedUrl: FEED,
      homeUrl: `${PODCAST}/`,
      network: "rss",
      category: "podcast",
      name: "Synthetic Commons Radio",
      iconUrl: `${PODCAST}/art/cover-3000.jpg`,
      manifest: { format: "rss", podcast: true },
    });
    expect(previewView(preview)).toMatchObject({ kind: "Podcast feed", address: "synthetic-podcast.example" });
    // The hub adapter is asked first; its 404 passes the address on.
    expect(replay.calls).toEqual([`GET ${PODCAST}/.well-known/civic.json`, `GET ${FEED}`]);
  });

  it("resolves the home page through its <link rel=alternate> to the same feed", async () => {
    const replay = replayGuard();
    const preview = await resolveInput(`${PODCAST}/`, { guard: replay.guard, now: NOW });
    expect(preview).toMatchObject({ adapter: "rss", canonicalUrl: FEED, manifest: { discoveredFrom: `${PODCAST}/` } });
    expect(replay.calls).toEqual([`GET ${PODCAST}/.well-known/civic.json`, `GET ${PODCAST}/`, `GET ${FEED}`]);
  });

  it("fetches episodes as podcasts with durations, newest first, within the 90-day window", async () => {
    const replay = replayGuard();
    const preview = await rssAdapter.resolve(FEED, { guard: replay.guard, now: NOW });
    const result = await rssAdapter.fetchNew(spaceFrom(preview), ctx(replay));
    expect(result.items.map((i) => [i.kind, i.title, i.media.find((m) => m.type === "audio")?.duration])).toEqual([
      ["podcast", "Episode 3: Libraries after dark", 2535],
      ["podcast", "Episode 2: The bridge vote", 3930],
      ["podcast", "Episode 1: Hello, neighbors", 1800],
    ]);
    // The pilot is older than the window but still counts for newest_item_at; the newest is ep 3.
    expect(ITEM_WINDOW_DAYS).toBe(90);
    expect(result.space).toMatchObject({
      etag: ETAG,
      etagUrl: FEED,
      newestItemAt: new Date("2026-10-20T09:00:00Z"),
      fetchStatus: "ok",
    });
    const [ep3, ep2] = result.items;
    expect(ep3).toMatchObject({
      sourceId: "synthetic-commons-radio-ep3",
      url: `${PODCAST}/episodes/3`,
      author: { name: "Ana Ruiz and Ben Okafor" },
    });
    expect(ep3!.media).toEqual([
      { type: "audio", url: `${PODCAST}/audio/ep3.mp3`, duration: 2535 },
      { type: "image", url: `${PODCAST}/art/ep3.jpg` },
    ]);
    // No episode image: the show's cover art.
    expect(ep2!.media[1]).toEqual({ type: "image", url: `${PODCAST}/art/cover-3000.jpg` });
    expect(JSON.stringify(result.items)).not.toMatch(/@synthetic-podcast\.example/);
  });

  it("sends If-None-Match for the stored ETag of the same URL, and a 304 keeps what is stored", async () => {
    const replay = replayGuard();
    const preview = await rssAdapter.resolve(FEED, { guard: replay.guard, now: NOW });
    const result = await rssAdapter.fetchNew(spaceFrom(preview, { etag: ETAG, etagUrl: FEED }), ctx(replay));
    expect(result).toMatchObject({ notModified: true, items: [] });
    // An ETag stored for another URL isn't sent: the 200 answers.
    const other = await rssAdapter.fetchNew(spaceFrom(preview, { etag: ETAG, etagUrl: `${FEED}?old` }), ctx(replay));
    expect(other.notModified).toBe(false);
    expect(other.items).toHaveLength(3);
  });

  it("an undated episode already stored keeps its first time (DERIVED: no pubDate)", async () => {
    const replay0 = replayGuard();
    const preview = await rssAdapter.resolve(FEED, { guard: replay0.guard, now: NOW });
    const undated = derived(FEED, {
      status: 200,
      body: feedBody().replace(/<pubDate>Tue, 20 Oct 2026 09:00:00 GMT<\/pubDate>/, ""),
    });
    const replay = replayGuard([undated]);
    const fresh = await rssAdapter.fetchNew(spaceFrom(preview), ctx(replay));
    expect(fresh.items.find((i) => i.sourceId === "synthetic-commons-radio-ep3")?.publishedAt).toEqual(NOW);
    const again = await rssAdapter.fetchNew(spaceFrom(preview), ctx(replay, { isKnown: (id) => id === "synthetic-commons-radio-ep3" }));
    expect(again.items.map((i) => i.sourceId)).not.toContain("synthetic-commons-radio-ep3");
  });

  it("errors in the follow box's words", async () => {
    // A page with no feed link isn't a Space (DERIVED: the home page without its <link>).
    const noLink = derived(`${PODCAST}/`, { body: "<!doctype html><html><head><title>x</title></head></html>" });
    let err = await rejection(rssAdapter.resolve(`${PODCAST}/`, { guard: replayGuard([noLink]).guard, now: NOW }));
    expect(err.reason).toBe("not_a_space");
    // A missing feed (DERIVED: 404).
    err = await rejection(rssAdapter.resolve(FEED, { guard: replayGuard([derived(FEED, { status: 404, body: "" })]).guard, now: NOW }));
    expect(err.reason).toBe("not_a_space");
    // A server error, and a 429 (DERIVED).
    err = await rejection(rssAdapter.resolve(FEED, { guard: replayGuard([derived(FEED, { status: 503, body: "" })]).guard, now: NOW }));
    expect(err.reason).toBe("unreachable");
    // The guard refuses private addresses: "This address can't be followed", no request.
    const replay = replayGuard();
    err = await rejection(resolveInput("https://127.0.0.1/feed.xml", { guard: replay.guard, now: NOW }));
    expect(err.reason).toBe("refused");
    expect(replay.calls).toEqual([]);
  });

  it("a feed that stops being a feed is an error on refresh (DERIVED: HTML at the feed URL)", async () => {
    const replay0 = replayGuard();
    const preview = await rssAdapter.resolve(FEED, { guard: replay0.guard, now: NOW });
    const html = derived(FEED, { status: 200, body: "<!doctype html><p>moved</p>", headers: { "content-type": "text/html" } });
    const err = await rejection(rssAdapter.fetchNew(spaceFrom(preview), ctx(replayGuard([html]))));
    expect(err.reason).toBe("not_a_space");
  });
});
