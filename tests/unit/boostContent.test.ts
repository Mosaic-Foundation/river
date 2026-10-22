// Boost cards carry the post they boost (spec 4.3 "Map"): during a fediverse refresh each boost's
// object is fetched through the guard, then its author, at most 20 dereferences per source per
// refresh. Real recorded boosts from @w3c@w3c.social and @eff@mastodon.social, replayed through
// the real fetch guard; responses marked DERIVED are test-only variants of a recorded one.
import { describe, expect, it } from "vitest";
import {
  BOOST_DEREFERENCE_LIMIT,
  fediverseAdapter,
  mapActivity,
} from "../../src/river/adapters/fediverse/index.js";
import type { FetchGuard } from "../../src/shared/fetch/index.js";
import type { FetchResult, NormalizedItem, SpaceRecord } from "../../src/shared/items/index.js";
import { derived, NOW, recordedJson, replayGuard, type ReplayGuard } from "./helpers/fediverseFixtures.js";

type Json = Record<string, unknown>;

const W3C_OUTBOX = "https://w3c.social/users/w3c/outbox";
const W3C_PAGE_1 = "https://w3c.social/users/w3c/outbox?page=true";
const W3CDEVS = "https://w3c.social/users/w3cdevs";
/** A real boost: @w3c boosted this @w3cdevs post (text and a link preview). */
const TEXT_POST = "https://w3c.social/users/w3cdevs/statuses/117471856565477515";
/** A real boost of a @w3cdevs post with one image. */
const IMAGE_POST = "https://w3c.social/users/w3cdevs/statuses/117438894958688993";
/** A real boost of a mastodon.social post; that server refuses unsigned actor reads. */
const PHILA_POST = "https://mastodon.social/users/PhilA/statuses/117404483086606616";
const PHILA = "https://mastodon.social/users/PhilA";
/** A real boost of a post on a host that isn't recorded: it can't be fetched in replay. */
const UNREACHABLE_POST = "https://mas.to/users/sphcow/statuses/117451397579521952";
const EFF_POST = "https://mastodon.social/users/eff/statuses/117474778224215675";

async function followed(handle: string, replay: ReplayGuard): Promise<SpaceRecord> {
  const preview = await fediverseAdapter.resolve(handle, { guard: replay.guard, now: NOW });
  return {
    id: "space-1",
    adapter: "fediverse",
    canonicalUrl: preview.canonicalUrl,
    feedUrl: preview.feedUrl ?? null,
    actorId: preview.actorId ?? null,
    network: preview.network ?? null,
    manifest: preview.manifest,
  };
}

/** The guard, with every URL it was asked for (requests that fail before sending included). */
function counting(guard: FetchGuard): { guard: FetchGuard; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    guard: {
      fetch(url, init) {
        urls.push(url);
        return guard.fetch(url, init);
      },
    },
  };
}

async function refreshW3c(overrides: Parameters<typeof replayGuard>[0] = []) {
  const replay = replayGuard(overrides);
  const space = await followed("@w3c@w3c.social", replay);
  const counted = counting(replay.guard);
  const result = await fediverseAdapter.fetchNew(space, { guard: counted.guard, now: NOW, isKnown: () => false });
  return { result, urls: counted.urls, replay };
}

function boostOf(result: FetchResult, objectId: string): NormalizedItem {
  const item = result.items.find((i) => i.boostOf?.objectId === objectId);
  if (!item) throw new Error(`no boost of ${objectId}`);
  return item;
}

function announceOf(objectId: string): Json {
  const announce = recordedJson<{ orderedItems: Json[] }>(W3C_PAGE_1).orderedItems.find(
    (a) => a.type === "Announce" && a.object === objectId,
  );
  if (!announce) throw new Error(`no recorded Announce of ${objectId}`);
  return announce;
}

/** Today's plain boost card for the recorded Announce: what the outbox alone gives. */
function plainCard(item: NormalizedItem): NormalizedItem | undefined {
  return mapActivity(item.raw, { author: item.author, now: NOW });
}

/** A page of the w3c outbox holding only `entries` and no next page (DERIVED). */
function onlyPage(entries: Json[]) {
  const page = recordedJson<Json>(W3C_PAGE_1);
  return derived(W3C_PAGE_1, { body: { ...page, orderedItems: entries, next: undefined } });
}

describe("boost cards carry the boosted post (real recorded boosts)", () => {
  it("fills a boost with the original post, its author's name, handle and avatar", async () => {
    const { result } = await refreshW3c();
    const item = boostOf(result, TEXT_POST);
    const post = recordedJson<Json>(TEXT_POST);
    const actor = recordedJson<Json & { icon: { url: string } }>(W3CDEVS);
    const announce = announceOf(TEXT_POST);

    expect(item).toMatchObject({
      // Still the boost: its own id and time, and the booster as `author`.
      sourceId: announce.id,
      publishedAt: new Date(announce.published as string),
      kind: "post",
      hidden: false,
      url: post.url,
      boostOf: {
        objectId: TEXT_POST,
        host: "w3c.social",
        url: post.url,
        author: { name: actor.name, handle: "@w3cdevs@w3c.social", url: actor.url, iconUrl: actor.icon.url },
      },
    });
    expect(item.author?.name).not.toBe(actor.name);
    expect(item.contentHtml).toContain("Want to trigger CSS animations");
    expect(item.raw).toEqual({ announce, object: post });
  });

  it("carries the boosted post's images with their alt text", async () => {
    const { result } = await refreshW3c();
    const item = boostOf(result, IMAGE_POST);
    const attachment = recordedJson<{ attachment: Json[] }>(IMAGE_POST).attachment[0] as Json;
    expect(item.kind).toBe("photo");
    expect(item.media).toEqual([
      expect.objectContaining({ type: "image", url: attachment.url, alt: attachment.name }),
    ]);
  });

  it("reads a mastodon.social author through Mastodon's account lookup when the actor answers 401", async () => {
    const replay = replayGuard([onlyPage([announceOf(PHILA_POST)])]);
    const space = await followed("@w3c@w3c.social", replay);
    replay.calls.length = 0;
    const result = await fediverseAdapter.fetchNew(space, { guard: replay.guard, now: NOW });
    const lookup = recordedJson<Json>("https://mastodon.social/api/v1/accounts/lookup?acct=PhilA");
    expect(boostOf(result, PHILA_POST).boostOf?.author).toEqual({
      name: lookup.display_name,
      handle: "@PhilA@mastodon.social",
      url: lookup.url,
      iconUrl: lookup.avatar,
    });
    expect(replay.calls.filter((c) => !c.startsWith(`GET ${W3C_OUTBOX}`))).toEqual([
      `GET ${PHILA_POST}`,
      `GET ${PHILA}`,
      "GET https://mastodon.social/api/v1/accounts/lookup?acct=PhilA",
    ]);
  });

  it("fills a Mastodon account's boost of its own post (@eff@mastodon.social)", async () => {
    const replay = replayGuard();
    const space = await followed("@eff@mastodon.social", replay);
    const result = await fediverseAdapter.fetchNew(space, { guard: replay.guard, now: NOW });
    const item = boostOf(result, EFF_POST);
    expect(item.contentHtml).toBeTruthy();
    expect(item.boostOf?.author).toMatchObject({ name: "Electronic Frontier Foundation", handle: "@eff@mastodon.social" });
    expect(item.boostOf?.author?.iconUrl).toMatch(/^https:\/\//);
  });

  it("keeps today's card when the boosted post can't be fetched", async () => {
    const { result } = await refreshW3c();
    const item = boostOf(result, UNREACHABLE_POST);
    expect(item).toEqual(plainCard(item));
    expect(item.contentHtml).toBeUndefined();
    expect(item.boostOf).toEqual({ objectId: UNREACHABLE_POST, host: "mas.to" });
  });

  it(`asks for at most ${BOOST_DEREFERENCE_LIMIT} posts and authors per refresh, each once`, async () => {
    const { result, urls } = await refreshW3c();
    const dereferences = urls.filter((u) => !u.startsWith(W3C_OUTBOX));
    // The recorded pages hold 18 boosts by 5 authors, more than the budget covers.
    expect(result.items.filter((i) => i.boostOf).length).toBeGreaterThan(BOOST_DEREFERENCE_LIMIT - 5);
    expect(dereferences).toHaveLength(BOOST_DEREFERENCE_LIMIT);
    expect(new Set(dereferences).size).toBe(dereferences.length);
    expect(dereferences.filter((u) => u === W3CDEVS)).toHaveLength(1);
  });
});

describe("boost content: what is refused (DERIVED from real recorded responses)", () => {
  const real = () => recordedJson<Json>(TEXT_POST);

  it("past the budget, boosts keep today's card (a page of 25 boosts)", async () => {
    const announce = announceOf(TEXT_POST);
    const many = Array.from({ length: 25 }, (_, n) => ({ ...announce, id: `${announce.id as string}/copy-${n}` }));
    const { result, urls } = await refreshW3c([onlyPage(many)]);
    expect(urls.filter((u) => !u.startsWith(W3C_OUTBOX))).toHaveLength(BOOST_DEREFERENCE_LIMIT);
    const plain = result.items.filter((i) => !i.contentHtml);
    expect(plain.length).toBeGreaterThanOrEqual(25 - BOOST_DEREFERENCE_LIMIT);
    for (const item of plain) expect(item).toEqual(plainCard(item));
  });

  it("keeps today's card for a post that isn't public", async () => {
    const followersOnly = { ...real(), to: [`${W3CDEVS}/followers`], cc: [] };
    const { result } = await refreshW3c([derived(TEXT_POST, { body: followersOnly })]);
    const item = boostOf(result, TEXT_POST);
    expect(item).toEqual(plainCard(item));
  });

  it("keeps today's card when the post is served from another host", async () => {
    const { result } = await refreshW3c([derived(TEXT_POST, { body: { ...real(), id: "https://mastodon.social/users/eff/statuses/1" } })]);
    const item = boostOf(result, TEXT_POST);
    expect(item).toEqual(plainCard(item));
  });

  it("shows a boosted public reply (the booster chose to share it)", async () => {
    const reply = { ...real(), inReplyTo: "https://w3c.social/users/w3c/statuses/1" };
    const { result } = await refreshW3c([derived(TEXT_POST, { body: reply })]);
    const item = boostOf(result, TEXT_POST);
    expect(item.hidden).toBe(false);
    expect(item.contentHtml).toContain("Want to trigger CSS animations");
  });

  it("sanitizes the boosted post's HTML", async () => {
    const hostile = { ...real(), content: '<p>Hello</p><script>alert(1)</script><img src=x onerror="alert(1)">' };
    const { result } = await refreshW3c([derived(TEXT_POST, { body: hostile })]);
    const html = boostOf(result, TEXT_POST).contentHtml ?? "";
    expect(html).toContain("Hello");
    expect(html).not.toMatch(/<script|onerror/i);
  });

  it("never reads an author on another host than the post's", async () => {
    const elsewhere = { ...real(), attributedTo: "https://mastodon.social/users/eff" };
    const { result, urls } = await refreshW3c([derived(TEXT_POST, { body: elsewhere })]);
    const item = boostOf(result, TEXT_POST);
    expect(item.contentHtml).toContain("Want to trigger CSS animations");
    expect(item.boostOf?.author).toBeUndefined();
    expect(urls).not.toContain("https://mastodon.social/users/eff");
  });

  it("drops an author whose actor document names someone else", async () => {
    const actor = recordedJson<Json>(W3CDEVS);
    const impostor = derived(W3CDEVS, { body: { ...actor, id: "https://w3c.social/users/someone_else" } });
    const { result } = await refreshW3c([impostor]);
    expect(boostOf(result, TEXT_POST).boostOf?.author).toEqual({ url: W3CDEVS });
  });
});
