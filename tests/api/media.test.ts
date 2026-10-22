// M12 "Real media" over HTTP, against the running dev server (`npm run dev`, with
// FETCH_FIXTURES_DIR and TEST_CLOCK_NOW as tests/api/README.md describes): the follow box previews
// and follows a podcast feed (by its URL and by its home page) and a PeerTube channel, and their
// items reach the feed with the right kind and media. The two sources are SYNTHETIC fixtures
// (tests/fixtures/http/synthetic-*; TESTING.md), replayed through the real fetch guard.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API, DidLogServer, requireApi, type Member } from "./helpers/member.js";

const FEED = "https://synthetic-podcast.example/feed.xml";
const PODCAST_HOME = "https://synthetic-podcast.example/";
const CHANNEL = "https://synthetic-tube.example/video-channels/trail_films";

interface Preview {
  adapter: string;
  name: string;
  iconUrl: string | null;
  kind: string;
  category: string | null;
  address: string;
  canonicalUrl: string;
  stream: unknown;
}

interface MediaRef {
  type: string;
  url: string;
  duration?: number;
  width?: number;
  height?: number;
}

interface FeedItem {
  id: string;
  kind: string;
  title: string | null;
  url: string | null;
  media: MediaRef[];
  boostOf: unknown;
  contentHtml: string | null;
  source: string;
  space: { id: string; name: string; category: string | null; adapter: string };
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

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: member.cookie, origin: member.origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function preview(input: string): Promise<Preview> {
  const res = await call("POST", "/follow/preview", { input });
  expect(res.status, input).toBe(200);
  return ((await res.json()) as { preview: Preview }).preview;
}

/** Follows `input` into a new circle of its own and returns that circle's feed items. */
async function followIntoCircle(input: string, name: string): Promise<{ spaceId: string; items: FeedItem[] }> {
  const made = await call("POST", "/circles", { name, color: "#336699" });
  expect(made.status).toBe(201);
  const { circle } = (await made.json()) as { circle: { id: string } };
  const followed = await call("POST", "/follows", { input, scope: "space", circleIds: [circle.id] });
  expect(followed.status, input).toBe(201);
  const { spaceId } = (await followed.json()) as { spaceId: string };
  const res = await fetch(`${API}/feed?circle=${circle.id}`, { headers: { cookie: member.cookie } });
  expect(res.status).toBe(200);
  return { spaceId, items: ((await res.json()) as { items: FeedItem[] }).items };
}

describe("a podcast feed (M12, SYNTHETIC fixtures)", () => {
  it("previews the feed URL: name, cover art, Podcast feed", async () => {
    expect(await preview(FEED)).toEqual({
      adapter: "rss",
      name: "Synthetic Commons Radio",
      iconUrl: "https://synthetic-podcast.example/art/cover-3000.jpg",
      kind: "Podcast feed",
      category: "podcast",
      address: "synthetic-podcast.example",
      canonicalUrl: FEED,
      stream: null,
    });
  });

  it("previews the show's home page as the feed it names", async () => {
    expect(await preview(PODCAST_HOME)).toMatchObject({ adapter: "rss", canonicalUrl: FEED, name: "Synthetic Commons Radio" });
  });

  it("following it shows its episodes as podcasts with durations and an https link", async () => {
    const { spaceId, items } = await followIntoCircle(PODCAST_HOME, "Podcasts M12");
    expect(items.map((i) => i.title)).toEqual([
      "Episode 3: Libraries after dark",
      "Episode 2: The bridge vote",
      "Episode 1: Hello, neighbors",
    ]);
    for (const item of items) {
      expect(item).toMatchObject({ kind: "podcast", source: "live", space: { id: spaceId, adapter: "rss", category: "podcast" } });
      expect(item.url).toMatch(/^https:\/\/synthetic-podcast\.example\/episodes\/\d$/);
    }
    expect(items.map((i) => i.media.find((m) => m.type === "audio")?.duration)).toEqual([2535, 3930, 1800]);
    expect(items[0]!.media).toContainEqual({ type: "image", url: "https://synthetic-podcast.example/art/ep3.jpg" });
    // Sanitized HTML with the link's rel forced (Appendix B).
    expect(items[0]!.contentHtml).toContain('rel="nofollow noopener noreferrer"');
    // The content-type filter finds them as Podcasts.
    const podcasts = (await (await fetch(`${API}/feed?type=podcasts`, { headers: { cookie: member.cookie } })).json()) as {
      items: FeedItem[];
    };
    expect(podcasts.items.filter((i) => i.space.id === spaceId)).toHaveLength(3);

    const following = (await (await call("GET", "/following")).json()) as {
      spaces: Array<{ id: string; kind: string; adapter: string; address: string }>;
    };
    expect(following.spaces.find((s) => s.id === spaceId)).toMatchObject({ kind: "Podcast feed", adapter: "rss" });
  });
});

describe("a PeerTube channel (M12, SYNTHETIC fixtures)", () => {
  it("previews the channel's URL and handle: name, avatar, PeerTube channel", async () => {
    const byUrl = await preview(CHANNEL);
    expect(byUrl).toMatchObject({
      adapter: "fediverse",
      name: "Synthetic Trail Films",
      iconUrl: "https://synthetic-tube.example/lazy-static/avatars/trail_films-48.png",
      kind: "PeerTube channel",
      category: "video",
      address: "@trail_films@synthetic-tube.example",
      canonicalUrl: CHANNEL,
    });
    expect(await preview("@trail_films@synthetic-tube.example")).toEqual(byUrl);
  });

  it("following it shows its videos with duration and thumbnail", async () => {
    const { spaceId, items } = await followIntoCircle("@trail_films@synthetic-tube.example", "Videos M12");
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ["video", "Ridge line at dawn"],
      ["video", "Creek crossing after the storm"],
      ["video", "Trail maintenance day"],
    ]);
    for (const item of items) {
      expect(item).toMatchObject({ boostOf: null, source: "live", space: { id: spaceId, category: "video" } });
      expect(item.url).toMatch(/^https:\/\/synthetic-tube\.example\/w\//);
      expect(item.media.find((m) => m.type === "image")).toMatchObject({ width: 850, height: 480 });
    }
    expect(items.map((i) => i.media.find((m) => m.type === "video")?.duration)).toEqual([273, 725, 3723]);
    const videos = (await (await fetch(`${API}/feed?type=videos`, { headers: { cookie: member.cookie } })).json()) as {
      items: FeedItem[];
    };
    expect(videos.items.filter((i) => i.space.id === spaceId)).toHaveLength(3);
  });
});
