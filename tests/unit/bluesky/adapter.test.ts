// The Bluesky adapter end to end on recorded responses (ADR-009), replayed through the real fetch
// guard: resolving a handle, a bsky.app profile URL and a DID (verified both ways), the preview
// (name, avatar, bio), refusals, and fetchNew's paging, stop rules and handle changes. No network.
// Responses marked DERIVED are test-only variants of a recorded one (see ../helpers/).
import { describe, expect, it } from "vitest";
import {
  authorFeedUrl,
  blueskyAdapter,
  PLC_DIRECTORY,
  readManifest,
  xrpcUrl,
} from "../../../src/river/adapters/bluesky/index.js";
import { RATE_LIMITED_MESSAGE } from "../../../src/river/adapters/fediverse/index.js";
import { AdapterError, type SpacePreview, type SpaceRecord } from "../../../src/shared/items/index.js";
import type { HttpFixture } from "../../../src/shared/fetch/index.js";
import { derived, recordedJson, replayGuard } from "../helpers/fediverseFixtures.js";
import { BSKY_NOW, DIDS, recordedEntries } from "./helpers.js";

const resolveHandleUrl = (handle: string) => xrpcUrl("com.atproto.identity.resolveHandle", { handle });
const profileUrl = (did: string) => xrpcUrl("app.bsky.actor.getProfile", { actor: did });

async function resolve(input: string, overrides: HttpFixture[] = []) {
  const replay = replayGuard(overrides);
  const preview = await blueskyAdapter.resolve(input, { guard: replay.guard, now: BSKY_NOW });
  return { preview, calls: replay.calls };
}

async function reason(input: string, overrides: HttpFixture[] = []): Promise<AdapterError> {
  try {
    await resolve(input, overrides);
  } catch (err) {
    if (err instanceof AdapterError) return err;
    throw err;
  }
  throw new Error(`${input} resolved`);
}

function spaceFrom(preview: SpacePreview, extra: Partial<SpaceRecord> = {}): SpaceRecord {
  return {
    id: "space-1",
    adapter: "atproto",
    canonicalUrl: preview.canonicalUrl,
    actorId: preview.actorId ?? null,
    network: preview.network ?? null,
    manifest: preview.manifest,
    ...extra,
  };
}

describe("resolve", () => {
  it("a custom-domain handle: resolveHandle, the DID document, the profile; keyed by DID", async () => {
    const { preview, calls } = await resolve("@bsky.app");
    expect(calls).toEqual([
      `GET ${resolveHandleUrl("bsky.app")}`,
      `GET ${PLC_DIRECTORY}/${DIDS.bskyApp}`,
      `GET ${profileUrl(DIDS.bskyApp)}`,
    ]);
    expect(preview).toMatchObject({
      adapter: "atproto",
      canonicalUrl: `at://${DIDS.bskyApp}`,
      actorId: DIDS.bskyApp,
      homeUrl: `https://bsky.app/profile/${DIDS.bskyApp}`,
      name: "Bluesky",
      network: "bluesky",
      category: "person",
    });
    expect(preview.iconUrl).toMatch(/^https:\/\/cdn\.bsky\.app\//);
    expect(preview.description).toBeTruthy();
    expect(readManifest(preview.manifest).actor).toMatchObject({ id: DIDS.bskyApp, handle: "@bsky.app", name: "Bluesky" });
    expect(readManifest(preview.manifest).pds).toMatch(/^https:\/\//);
  });

  it("a bsky.social handle, its profile URL and its DID are the same space", async () => {
    const byHandle = (await resolve("@publicdomainrev.bsky.social")).preview;
    const byUrl = (await resolve("https://bsky.app/profile/publicdomainrev.bsky.social")).preview;
    expect(byHandle.name).toBe("The Public Domain Review");
    expect(byUrl.canonicalUrl).toBe(byHandle.canonicalUrl);
    expect(byHandle.canonicalUrl).toBe(`at://${DIDS.publicDomainReview}`);
  });

  it("a DID typed directly takes its handle from the profile when the document claims it", async () => {
    const { preview, calls } = await resolve(DIDS.atproto);
    expect(calls).toEqual([`GET ${PLC_DIRECTORY}/${DIDS.atproto}`, `GET ${profileUrl(DIDS.atproto)}`]);
    expect(preview.name).toBe("AT Protocol Developers");
    expect(readManifest(preview.manifest).actor?.handle).toBe("@atproto.com");
  });

  it("DERIVED: a DID whose document doesn't claim the profile's handle has no handle", async () => {
    const doc = recordedJson(`${PLC_DIRECTORY}/${DIDS.atproto}`);
    const { preview } = await resolve(DIDS.atproto, [
      derived(`${PLC_DIRECTORY}/${DIDS.atproto}`, { body: { ...doc, alsoKnownAs: ["at://someone-else.example.com"] } }),
    ]);
    expect(readManifest(preview.manifest).actor?.handle).toBeUndefined();
    expect(preview.name).toBe("AT Protocol Developers");
  });

  it("DERIVED: a handle whose DID document names another handle isn't that account", async () => {
    const doc = recordedJson(`${PLC_DIRECTORY}/${DIDS.bskyApp}`);
    const err = await reason("@bsky.app", [
      derived(`${PLC_DIRECTORY}/${DIDS.bskyApp}`, { body: { ...doc, alsoKnownAs: ["at://impostor.example.com"] } }),
    ]);
    expect(err.reason).toBe("not_a_space");
  });

  it("DERIVED: when the AppView can't resolve a handle, the handle's own well-known document can", async () => {
    const handle = "publicdomainrev.bsky.social";
    const wellKnown = `https://${handle}/.well-known/atproto-did`;
    const { preview, calls } = await resolve(`@${handle}`, [
      derived(resolveHandleUrl(handle), { status: 400, body: { error: "InvalidRequest", message: "Unable to resolve handle" } }),
      { url: wellKnown, status: 200, headers: { "content-type": "text/plain" }, body: `${DIDS.publicDomainReview}\n` },
    ]);
    expect(calls).toContain(`GET ${wellKnown}`);
    expect(preview.canonicalUrl).toBe(`at://${DIDS.publicDomainReview}`);
  });

  it("DERIVED: an unknown handle isn't a Space", async () => {
    const handle = "publicdomainrev.bsky.social";
    const err = await reason(`@${handle}`, [
      derived(resolveHandleUrl(handle), { status: 400, body: { error: "InvalidRequest", message: "Unable to resolve handle" } }),
      { url: `https://${handle}/.well-known/atproto-did`, status: 404, headers: { "content-type": "text/plain" }, body: "" },
    ]);
    expect(err.reason).toBe("not_a_space");
    expect(err.message).toBe("That address isn't a Space we can follow");
  });

  it("DERIVED: an account that hides from signed-out readers can't be followed", async () => {
    const profile = recordedJson(profileUrl(DIDS.bskyApp));
    const err = await reason("@bsky.app", [
      derived(profileUrl(DIDS.bskyApp), {
        body: { ...profile, labels: [{ src: DIDS.bskyApp, uri: `at://${DIDS.bskyApp}`, val: "!no-unauthenticated", cts: "2026-10-01T00:00:00Z" }] },
      }),
    ]);
    expect(err.reason).toBe("refused");
  });

  it("DERIVED: a 429 from the AppView is reported, not retried", async () => {
    const err = await reason(DIDS.atproto, [
      derived(profileUrl(DIDS.atproto), { status: 429, headers: { "retry-after": "30" }, body: { error: "RateLimitExceeded" } }),
    ]);
    expect(err.reason).toBe("unreachable");
    expect(err.message).toBe(RATE_LIMITED_MESSAGE);
  });

  it("DERIVED: a profile for another DID than the one asked for is refused", async () => {
    const other = recordedJson(profileUrl(DIDS.bskyApp));
    const err = await reason(DIDS.atproto, [derived(profileUrl(DIDS.atproto), { body: other })]);
    expect(err.reason).toBe("not_a_space");
  });
});

describe("fetchNew", () => {
  it("reads two pages of the author feed without replies and stores each page as it arrives", async () => {
    const { preview } = await resolve("@bsky.app");
    const replay = replayGuard();
    const pages: number[] = [];
    const result = await blueskyAdapter.fetchNew(spaceFrom(preview), {
      guard: replay.guard,
      now: BSKY_NOW,
      isKnown: () => false,
      onPage: (items) => {
        pages.push(items.length);
      },
    });
    expect(replay.calls[0]).toBe(`GET ${authorFeedUrl(DIDS.bskyApp)}`);
    expect(replay.calls[0]).toContain("filter=posts_no_replies");
    expect(replay.calls).toHaveLength(2);
    expect(pages).toHaveLength(2);
    expect(result.items.length).toBe(pages[0]! + pages[1]!);
    expect(result.items.some((i) => i.boostOf)).toBe(true);
    expect(result.items.some((i) => !i.boostOf)).toBe(true);
    expect(result.space).toMatchObject({ fetchStatus: "ok", lastError: null });
    expect(result.space.newestItemAt?.toISOString()).toBe("2026-10-23T17:06:33.547Z");
    // Nothing changed about the account since resolve: the manifest isn't rewritten.
    expect(result.space.manifest).toBeUndefined();
  });

  it("stops at the first post already stored", async () => {
    const { preview } = await resolve("@bsky.app");
    const entries = recordedEntries(DIDS.bskyApp);
    const third = entries[2] as { reason?: { uri: string }; post: { uri: string } };
    const known = third.reason?.uri ?? third.post.uri;
    const replay = replayGuard();
    const result = await blueskyAdapter.fetchNew(spaceFrom(preview), {
      guard: replay.guard,
      now: BSKY_NOW,
      isKnown: (id) => id === known,
    });
    expect(result.items).toHaveLength(2);
    expect(replay.calls).toHaveLength(1);
  });

  it("stops at posts older than 90 days (retention would remove them)", async () => {
    const { preview } = await resolve("@bsky.app");
    // Two pages reach back to June; 90 days before 2026-10-23 is 2026-07-25.
    const result = await blueskyAdapter.fetchNew(spaceFrom(preview), { guard: replayGuard().guard, now: BSKY_NOW, isKnown: () => false });
    const cutoff = BSKY_NOW.getTime() - 90 * 24 * 60 * 60 * 1000;
    expect(result.items.every((i) => i.publishedAt.getTime() >= cutoff)).toBe(true);
    expect(recordedEntries(DIDS.bskyApp).length).toBeGreaterThan(result.items.length);
  });

  it("a handle change reaches the manifest from the feed itself; the space keeps its DID", async () => {
    const { preview } = await resolve("@bsky.app");
    const manifest = readManifest(preview.manifest);
    const stale = { ...preview.manifest, actor: { ...manifest.actor, handle: "@old-name.bsky.social", preferredUsername: "old-name.bsky.social" } };
    const replay = replayGuard();
    const result = await blueskyAdapter.fetchNew(spaceFrom(preview, { manifest: stale }), {
      guard: replay.guard,
      now: BSKY_NOW,
      isKnown: () => false,
    });
    expect(replay.calls.every((c) => c.includes(encodeURIComponent(DIDS.bskyApp)))).toBe(true);
    expect(readManifest(result.space.manifest ?? {}).actor).toMatchObject({ id: DIDS.bskyApp, handle: "@bsky.app", name: "Bluesky" });
  });

  it("reads the DID from the canonical URL when actor_id is missing", async () => {
    const { preview } = await resolve(DIDS.atproto);
    const replay = replayGuard();
    await blueskyAdapter.fetchNew(spaceFrom(preview, { actorId: null }), { guard: replay.guard, now: BSKY_NOW, isKnown: () => true });
    expect(replay.calls).toEqual([`GET ${authorFeedUrl(DIDS.atproto)}`]);
  });

  it("DERIVED: a taken-down account is an error for the refresh, in the follow box's words", async () => {
    const { preview } = await resolve(DIDS.atproto);
    const replay = replayGuard([
      derived(authorFeedUrl(DIDS.atproto), { status: 400, body: { error: "AccountTakedown", message: "Account has been suspended" } }),
    ]);
    await expect(blueskyAdapter.fetchNew(spaceFrom(preview), { guard: replay.guard, now: BSKY_NOW })).rejects.toMatchObject({
      reason: "not_a_space",
    });
  });
});
