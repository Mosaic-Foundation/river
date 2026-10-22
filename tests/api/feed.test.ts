// GET /api/feed against the running dev server (`npm run dev`, reading .env with
// FETCH_FIXTURES_DIR=tests/fixtures/http and TEST_CLOCK_NOW at the hub fixtures' clock), as a
// visitor: checks 1, 2, 5, 6 and the visitor half of 23, plus check 26's API part.
// Called over HTTP only; the one database connection counts rows river_app can't see.
import http from "node:http";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL } from "./db/roles.js";

const API = process.env.API_URL ?? "http://localhost:3000";

interface FeedItem {
  id: string;
  kind: string;
  publishedAt: string;
  title: string | null;
  summary: string | null;
  contentHtml: string | null;
  url: string | null;
  source: "live" | "sample";
  media: Array<{ url: string; alt?: string; duration?: number }>;
  space: { id: string; name: string; iconUrl: string | null; category: string | null; adapter: string };
}

interface Feed {
  instance: { name: string; theme: string; modes: string[]; defaultMode: string };
  mode: string;
  circles: Array<{ id: string; name: string; role: string | null }>;
  items: FeedItem[];
  nextCursor: string | null;
  empty: boolean;
  emptyMessage: string | null;
  refresh: { claimed: string[]; pending: string[] };
}

async function getFeed(query: Record<string, string> = {}): Promise<Feed> {
  const res = await fetch(`${API}/feed?${new URLSearchParams(query)}`);
  if (res.status !== 200) throw new Error(`GET /feed answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as Feed;
}

/** Every page of a query, following nextCursor. */
async function allItems(query: Record<string, string> = {}): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const feed: Feed = await getFeed(cursor ? { ...query, cursor } : query);
    items.push(...feed.items);
    cursor = feed.nextCursor;
    if (!cursor) return items;
  }
  throw new Error("more than 100 pages");
}

/** A GET with a chosen Host header (fetch won't send one). */
function getWithHost(path: string, host: string): Promise<{ status: number; body: string }> {
  const url = new URL(path, API);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { host } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

let everything: FeedItem[] = [];

beforeAll(async () => {
  try {
    await fetch(`${API}/health`);
  } catch {
    throw new Error(`No API at ${API}. Start it with \`npm run dev\` (see tests/api/README.md).`);
  }
  // The first open resolves and fetches the seed follows from the recordings. Replay is fast, but
  // a refresh still running when the budget ends shows up on a later open: wait for it.
  for (let i = 0; i < 20; i++) {
    const feed = await getFeed();
    if (feed.refresh.pending.length === 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  everything = await allItems();
}, 60_000);

describe("visitor feed (checks 1 and 2)", () => {
  it("has Live items from each seed hub and at least five Samples, newest first", () => {
    for (const hub of ["Demosville", "Floyd", "Longmont"]) {
      expect(
        everything.some((i) => i.source === "live" && i.space.adapter === "civic_hub" && i.space.name.includes(hub)),
        hub,
      ).toBe(true);
    }
    expect(everything.filter((i) => i.source === "sample").length).toBeGreaterThanOrEqual(5);
    const times = everything.map((i) => Date.parse(i.publishedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(new Set(everything.map((i) => i.id)).size).toBe(everything.length);
  });

  it("also has the fediverse seeds", () => {
    expect(new Set(everything.filter((i) => i.space.adapter === "fediverse").map((i) => i.space.name)).size).toBe(6);
  });

  it("every item has its source name, kind, time and exactly one of Live or Sample", () => {
    for (const item of everything) {
      expect(item.space.name, item.id).toBeTruthy();
      expect(["post", "article", "podcast", "video", "photo", "event", "civic"]).toContain(item.kind);
      expect(Number.isNaN(Date.parse(item.publishedAt))).toBe(false);
      expect(["live", "sample"]).toContain(item.source);
      expect(item.source === "sample").toBe(item.space.adapter === "sample");
      if (item.source === "sample") {
        expect(item.url).toBeNull();
      } else {
        expect(item.url ?? "https://", item.id).toMatch(/^https:\/\//);
      }
      for (const media of item.media) {
        // Samples use the UI's own placeholders; live media is https only.
        expect(media.url).toMatch(item.source === "sample" ? /^\/samples\/[a-z-]+\.svg$/ : /^https:\/\//);
      }
    }
  });

  it("a sample event says when and where it starts", () => {
    const event = everything.find((i) => i.source === "sample" && i.kind === "event") as
      | (FeedItem & { event?: { startTime?: string; location?: string } })
      | undefined;
    expect(event?.event?.location).toBe("Elm Street and Fourth Avenue");
    expect(Date.parse(event?.event?.startTime ?? "")).toBeGreaterThan(Date.parse(event?.publishedAt ?? ""));
  });

  it("names the instance's circles and default mode", async () => {
    const feed = await getFeed();
    expect(feed.mode).toBe("everything");
    expect(feed.circles.map((c) => c.name)).toEqual(["Civic", "News and ideas", "Family", "Soccer", "Neighborhood"]);
    expect(feed.circles.find((c) => c.role === "civic")?.name).toBe("Civic");
  });
});

describe("filters (check 5)", () => {
  it("News and ideas + Podcasts shows only the sample podcast episode", async () => {
    const feed = await getFeed({ circle: "News and ideas", type: "podcasts" });
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ kind: "podcast", source: "sample", space: { name: "Small Town Signals" } });
    expect(feed.items[0]?.media[0]?.duration).toBeGreaterThan(0);
    expect(feed.empty).toBe(false);
  });

  it("a combination with no matches returns the empty flag and sentence", async () => {
    const feed = await getFeed({ circle: "Family", type: "videos" });
    expect(feed.items).toEqual([]);
    expect(feed.empty).toBe(true);
    expect(feed.emptyMessage).toBe("Nothing of that type in this circle yet.");
  });

  it("a circle shows only its spaces; a type only its kind", async () => {
    const family = await allItems({ circle: "Family" });
    expect(family.length).toBeGreaterThan(0);
    expect(new Set(family.map((i) => i.space.name))).toEqual(new Set(["The Okafor Family"]));
    const events = await allItems({ type: "events" });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((i) => i.kind === "event")).toBe(true);
  });

  it("several types show any of those kinds; networks show only their adapters (ui-revisions-1)", async () => {
    const mixed = await allItems({ type: "events,photos" });
    expect(new Set(mixed.map((i) => i.kind))).toEqual(new Set(["event", "photo"]));
    const hubs = await allItems({ network: "hubs" });
    expect(hubs.length).toBeGreaterThan(0);
    expect(hubs.every((i) => i.space.adapter === "civic_hub")).toBe(true);
    const fedi = await allItems({ network: "fediverse" });
    expect(fedi.length).toBeGreaterThan(0);
    expect(fedi.every((i) => i.space.adapter === "fediverse")).toBe(true);
    const both = await allItems({ network: "hubs,fediverse" });
    expect(both.length).toBe(hubs.length + fedi.length);
    const hubPhotos = await allItems({ network: "hubs", type: "photos" });
    expect(hubPhotos.every((i) => i.kind === "photo" && i.space.adapter === "civic_hub")).toBe(true);
  });

  it("civic mode shows only civic-category spaces and the Civic circle", async () => {
    const civic = await allItems({ mode: "civic" });
    expect(civic.length).toBeGreaterThan(0);
    expect(civic.every((i) => i.space.category === "civic")).toBe(true);
  });

  it("refuses an unknown mode, circle, type or cursor", async () => {
    for (const query of ["mode=party", "circle=Bowling", "type=memes", "cursor=nope", "type=a&type=b", "network=bluesky"]) {
      const res = await fetch(`${API}/feed?${query}`);
      expect(res.status, query).toBe(400);
    }
  });
});

describe("one item for the reader view (ui-revisions-1 item 1)", () => {
  it("answers a stored item of the reader's River, the same as the feed shows it", async () => {
    for (const sample of [everything.find((i) => i.source === "live")!, everything.find((i) => i.source === "sample")!]) {
      const res = await fetch(`${API}/items/${sample.id}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const { item } = (await res.json()) as { item: FeedItem };
      expect(item).toEqual(sample);
    }
  });

  it("404 for an unknown item, 400 for a malformed id", async () => {
    const missing = await fetch(`${API}/items/00000000-0000-4000-8000-00000000abcd`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe("not_found");
    const bad = await fetch(`${API}/items/nope`);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("bad_item");
  });

  it("never shows an item outside the reader's follows", async () => {
    const db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    try {
      const followed = [...new Set(everything.map((i) => i.space.id))];
      const { rows } = await db.query<{ id: string }>(
        "SELECT id FROM river.items WHERE NOT (space_id = ANY($1::uuid[])) OR hidden LIMIT 5",
        [followed],
      );
      for (const row of rows) expect((await fetch(`${API}/items/${row.id}`)).status, row.id).toBe(404);
    } finally {
      await db.end();
    }
  });
});

describe("whether an opened item can be framed (ui-revisions-2 item 2, ADR-008)", () => {
  /** The stored item with this URL in the reader's River (the admin role only finds its id). */
  async function itemWithUrl(url: string): Promise<string> {
    const db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    try {
      const { rows } = await db.query<{ id: string }>("SELECT id FROM river.items WHERE url = $1 AND NOT hidden LIMIT 1", [url]);
      if (!rows[0]) throw new Error(`No stored item for ${url}`);
      return rows[0].id;
    } finally {
      await db.end();
    }
  }

  async function frame(id: string): Promise<{ status: number; body: { frame?: { url: string } | null; error?: string } }> {
    const res = await fetch(`${API}/items/${id}/frame`);
    if (res.status === 200) expect(res.headers.get("cache-control")).toBe("no-store");
    return { status: res.status, body: (await res.json()) as { frame?: { url: string } | null } };
  }

  it("frames a page whose recorded headers allow it, and not one that sends DENY", async () => {
    const article = "https://socialwebfoundation.org/2026/10/13/fosdem-2027-dev-room-application-is-in/";
    expect(await frame(await itemWithUrl(article))).toEqual({ status: 200, body: { frame: { url: article } } });
    const hub = "https://longmont.civic.social/meeting-summary/proc_4ebb11759c4c40ce";
    expect(await frame(await itemWithUrl(hub))).toEqual({ status: 200, body: { frame: null } });
  });

  it("a sample never frames; a page that isn't recorded doesn't either", async () => {
    expect(await frame(everything.find((i) => i.source === "sample")!.id)).toEqual({ status: 200, body: { frame: null } });
    const elsewhere = await itemWithUrl("https://mas.to/users/sphcow/statuses/117451397579521952");
    expect(await frame(elsewhere)).toEqual({ status: 200, body: { frame: null } });
  });

  it("404 for an item outside the reader's River, 400 for a malformed id", async () => {
    expect((await frame("00000000-0000-4000-8000-00000000abcd")).status).toBe(404);
    expect((await frame("nope")).status).toBe(400);
  });
});

describe("search (check 6)", () => {
  it("a word from a fixture title returns that item and nothing unrelated", async () => {
    const title = "How should Floyd County handle its growing bear population?";
    expect(everything.some((i) => i.title === title)).toBe(true);
    const found = await allItems({ q: "bear" });
    expect(found.some((i) => i.title === title)).toBe(true);
    for (const item of found) {
      const text = [item.title, item.summary, item.contentHtml, item.space.name].join(" ");
      expect(text, item.id).toMatch(/\bbear\b/i);
    }
    expect(found.length).toBeLessThan(everything.length);
  });

  it("matches the source name too", async () => {
    const found = await allItems({ q: "Trailhead" });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((i) => i.space.name === "Trailhead TV")).toBe(true);
  });

  it("treats % and _ literally", async () => {
    const feed = await getFeed({ q: "%" });
    expect(feed.items).toEqual([]);
    expect(feed.empty).toBe(true);
  });
});

describe("visitors write nothing (check 23, visitor part)", () => {
  const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  afterAll(async () => {
    await admin.end();
  });

  async function personalRows(): Promise<Record<string, number>> {
    const { rows } = await admin.query(
      `SELECT (SELECT count(*) FROM river.accounts)::int AS accounts, (SELECT count(*) FROM river.follows)::int AS follows,
              (SELECT count(*) FROM river.circles)::int AS circles, (SELECT count(*) FROM river.circle_members)::int AS circle_members,
              (SELECT count(*) FROM river.read_state)::int AS read_state, (SELECT count(*) FROM river.preferences)::int AS preferences`,
    );
    return rows[0] as Record<string, number>;
  }

  it("reading and filtering stores no account, follow, circle, read state or preference, and sets no cookie", async () => {
    const before = await personalRows();
    for (const query of ["", "circle=Soccer", "type=photos", "q=library", "mode=civic"]) {
      const res = await fetch(`${API}/feed?${query}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(await personalRows()).toEqual(before);
  });

  it("a visitor can't write read state on the server", async () => {
    // RIVER_PUBLIC_ORIGIN, from the sign-in redirect's client_id: state-changing routes need it.
    const start = await fetch(`${API}/auth/signin`, { redirect: "manual" });
    const origin = new URL(start.headers.get("location") ?? "").searchParams.get("client_id") ?? "";
    const before = await personalRows();
    for (const path of ["/read-state", "/read-state/all"]) {
      const res = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ read: [] }),
      });
      expect(res.status).toBe(401);
    }
    // And without the River's Origin, nothing state-changing is even considered.
    expect((await fetch(`${API}/read-state`, { method: "POST" })).status).toBe(403);
    expect(await personalRows()).toEqual(before);
  });
});

describe("instance by hostname (check 26, API part)", () => {
  it("an alias gets the seed instance; an unknown host gets 404", async () => {
    const ok = await getWithHost("/feed", "localhost");
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).instance).toMatchObject({ name: "Mosaic River", theme: "mosaic" });
    const unknown = await getWithHost("/feed", "unknown.example");
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.body)).toMatchObject({ error: "unknown_host" });
  });
});
