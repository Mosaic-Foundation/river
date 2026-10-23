// Following Bluesky accounts over HTTP (ADR-009), against the running dev server (`npm run dev`,
// with FETCH_FIXTURES_DIR and TEST_CLOCK_NOW as tests/api/README.md describes). The follow box
// previews a handle (name, avatar, bio), following it brings its posts and reposts into the feed,
// and a handle, a bsky.app profile URL and a DID all reach the one space keyed by DID. The
// responses are real recordings from Bluesky's public AppView and the PLC directory, replayed
// through the real fetch guard.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API, DidLogServer, requireApi, type Member } from "./helpers/member.js";

const BSKY_APP_DID = "did:plc:z72i7hdynmk6r22z27h6tvur";
const PDR_DID = "did:plc:ywdrhkssnvgtfyujsz45jnlb";
const ATPROTO_DID = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";

interface Preview {
  adapter: string;
  name: string;
  iconUrl: string | null;
  description: string | null;
  kind: string;
  address: string;
  canonicalUrl: string;
  stream: unknown;
}

interface FeedItem {
  id: string;
  kind: string;
  url: string | null;
  media: Array<{ type: string; url: string; alt?: string }>;
  author: { name?: string; handle?: string } | null;
  boostOf: { author?: { handle?: string }; fetched?: boolean } | null;
  contentHtml: string | null;
  embed?: {
    link?: { url: string; title?: string };
    quote?: { url?: string; author?: { handle?: string }; text?: string; unavailable?: boolean };
  };
  source: string;
  space: { id: string; name: string; adapter: string };
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

async function circle(name: string): Promise<string> {
  const res = await call("POST", "/circles", { name, color: "#2F6FA8" });
  expect(res.status).toBe(201);
  return ((await res.json()) as { circle: { id: string } }).circle.id;
}

async function follow(input: string, circleIds: string[] = []): Promise<string> {
  const res = await call("POST", "/follows", { input, circleIds });
  expect(res.status, input).toBe(201);
  return ((await res.json()) as { spaceId: string }).spaceId;
}

async function itemsIn(circleId: string): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  let cursor: string | null = null;
  for (let n = 0; n < 20; n++) {
    const params = new URLSearchParams({ circle: circleId, ...(cursor ? { cursor } : {}) });
    const res = await fetch(`${API}/feed?${params}`, { headers: { cookie: member.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: FeedItem[]; nextCursor: string | null };
    items.push(...body.items);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return items;
}

describe("following a Bluesky account (ADR-009)", () => {
  it("previews @bsky.app with its name, avatar and bio", async () => {
    const shown = await preview("@bsky.app");
    expect(shown).toMatchObject({
      adapter: "atproto",
      name: "Bluesky",
      kind: "Bluesky account",
      address: "@bsky.app",
      canonicalUrl: `at://${BSKY_APP_DID}`,
      stream: null,
    });
    expect(shown.iconUrl).toMatch(/^https:\/\/cdn\.bsky\.app\//);
    expect(shown.description).toBeTruthy();
  });

  it("following it shows its posts and its reposts as boost cards under the original author", async () => {
    const circleId = await circle("Just Bluesky");
    const spaceId = await follow("@bsky.app", [circleId]);
    const items = await itemsIn(circleId);
    expect(items.length).toBeGreaterThan(10);
    expect(items.every((i) => i.space.id === spaceId && i.space.adapter === "atproto" && i.source === "live")).toBe(true);
    expect(items.every((i) => i.url?.startsWith("https://bsky.app/profile/did:plc:"))).toBe(true);
    const reposts = items.filter((i) => i.boostOf !== null);
    expect(reposts.length).toBeGreaterThan(0);
    expect(reposts.every((i) => i.author?.handle === "@bsky.app" && i.boostOf?.fetched === true)).toBe(true);
    expect(reposts.some((i) => i.boostOf?.author?.handle && i.boostOf.author.handle !== "@bsky.app")).toBe(true);
    expect(items.some((i) => i.boostOf === null && i.author?.handle === "@bsky.app")).toBe(true);
    expect(items.some((i) => i.kind === "video" && i.media[0]?.type === "image")).toBe(true);
    // Reposts of accounts that hide from signed-out readers are stored hidden, never shown.
    expect(items.some((i) => i.boostOf?.author?.handle === "@vtben.bsky.social")).toBe(false);
    expect((await call("DELETE", `/circles/${circleId}`)).status).toBe(204);
  });

  it("a handle, a bsky.app profile URL and a DID reach the same space, keyed by DID", async () => {
    const byHandle = await follow("@publicdomainrev.bsky.social");
    expect(await follow("https://bsky.app/profile/publicdomainrev.bsky.social")).toBe(byHandle);
    expect(await follow(PDR_DID)).toBe(byHandle);
    expect((await preview(`at://${PDR_DID}`)).canonicalUrl).toBe(`at://${PDR_DID}`);

    const res = await call("GET", "/following");
    const page = (await res.json()) as { spaces: Array<{ id: string; address: string; kind: string; following: boolean }> };
    const pdr = page.spaces.filter((s) => s.id === byHandle);
    expect(pdr).toHaveLength(1);
    expect(pdr[0]).toMatchObject({ address: "@publicdomainrev.bsky.social", kind: "Bluesky account", following: true });
  });

  it("follows an account by DID and shows its link cards' posts", async () => {
    const circleId = await circle("AT Protocol");
    const spaceId = await follow(ATPROTO_DID, [circleId]);
    const items = await itemsIn(circleId);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.space.id === spaceId)).toBe(true);
    expect(items.some((i) => (i.contentHtml ?? "").includes('href="https://'))).toBe(true);
    expect((await call("DELETE", `/circles/${circleId}`)).status).toBe(204);
  });

  it("network=bluesky shows only Bluesky items, with their link cards and quoted posts (spec item 3)", async () => {
    await follow("@bsky.app");
    const res = await fetch(`${API}/feed?network=bluesky`, { headers: { cookie: member.cookie } });
    expect(res.status).toBe(200);
    const items = ((await res.json()) as { items: FeedItem[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.space.adapter === "atproto")).toBe(true);
    const all: FeedItem[] = [];
    let cursor: string | null = null;
    for (let n = 0; n < 20; n++) {
      const page = await fetch(`${API}/feed?network=bluesky${cursor ? `&cursor=${cursor}` : ""}`, { headers: { cookie: member.cookie } });
      const body = (await page.json()) as { items: FeedItem[]; nextCursor: string | null };
      all.push(...body.items);
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    const quote = all.find((i) => i.embed?.quote?.author?.handle === "@niedermeyer.online");
    expect(quote?.embed?.quote?.url).toMatch(/^https:\/\/bsky\.app\/profile\/did:plc:/);
    expect(all.some((i) => i.embed?.quote?.unavailable === true)).toBe(true);
    expect(all.some((i) => i.embed?.link?.url.startsWith("https://"))).toBe(true);
    // Other networks' items carry no embed.
    const hubs = ((await (await fetch(`${API}/feed?network=hubs,fediverse`, { headers: { cookie: member.cookie } })).json()) as { items: FeedItem[] }).items;
    expect(hubs.length).toBeGreaterThan(0);
    expect(hubs.every((i) => i.space.adapter !== "atproto" && i.embed === undefined)).toBe(true);
  });

  it("answers in the follow box's words for an account it can't reach, or malformed input", async () => {
    const res = await call("POST", "/follow/preview", { input: "@nobody-recorded.bsky.social" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toBe("We couldn't reach that address");
    // Malformed percent-encoding is an answer in F6's words, never a 500. A bsky.app URL that
    // isn't an account is a web address for the other adapters (unrecorded here: unreachable).
    const bad = await call("POST", "/follow/preview", { input: "did:%" });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { message: string }).message).toBe("That address isn't a Space we can follow");
    expect((await call("POST", "/follow/preview", { input: "https://bsky.app/profile/%E0" })).status).toBe(422);
  });
});
