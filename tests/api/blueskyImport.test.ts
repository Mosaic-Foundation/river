// "Import from Bluesky" over HTTP (docs/spec/bluesky-1.md item 4), against the running dev server
// (`npm run dev`, with FETCH_FIXTURES_DIR and TEST_CLOCK_NOW as tests/api/README.md describes).
// The preview lists who @eff.org follows, with a count; the import follows them all into a
// chosen circle, keyed by DID, skipping nothing it shouldn't and following nothing twice. The
// responses are real recordings of app.bsky.graph.getFollows (three pages), replayed through the
// real fetch guard.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API, DidLogServer, requireApi, type Member } from "./helpers/member.js";

const EFF_DID = "did:plc:lr36xv2l64jwtnyoaqem6z2z";

interface ImportPreview {
  account: { did: string; name: string; handle: string | null; iconUrl: string | null };
  count: number;
  skipped: number;
  truncated: boolean;
  accounts: Array<{ did: string; name: string; handle: string | null; iconUrl: string | null }>;
  removals: Array<{ spaceId: string; did: string; name: string; address: string; iconUrl: string | null }> | null;
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
