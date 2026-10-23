// Bluesky posts to items (ADR-009 item 4, ADR-003) on recorded getAuthorFeed entries. Entries
// marked DERIVED are test-only edits of a recorded one, for cases the recorded accounts don't show.
import { describe, expect, it } from "vitest";
import { mapFeedEntry, postHtml, readEmbed, type BlueskyRaw } from "../../../src/river/adapters/bluesky/index.js";
import type { NormalizedItem } from "../../../src/shared/items/index.js";
import { BSKY_NOW, DIDS, recordedEntries, recordedEntry } from "./helpers.js";

function map(entry: unknown): NormalizedItem {
  const item = mapFeedEntry(entry, { now: BSKY_NOW });
  if (!item) throw new Error("not mapped");
  return item;
}

function embedOf(item: NormalizedItem) {
  return (item.raw as BlueskyRaw).embed;
}

describe("text posts", () => {
  it("a post with a link card: kind post, text with its link facet, the card kept for the feed", () => {
    const item = map(recordedEntry(DIDS.atproto, "3myidcyrgv22f"));
    expect(item).toMatchObject({
      sourceId: `at://${DIDS.atproto}/app.bsky.feed.post/3myidcyrgv22f`,
      kind: "post",
      url: `https://bsky.app/profile/${DIDS.atproto}/post/3myidcyrgv22f`,
      author: {
        name: "AT Protocol Developers",
        handle: "@atproto.com",
        url: `https://bsky.app/profile/${DIDS.atproto}`,
      },
      hidden: false,
      media: [],
    });
    expect(item.author?.iconUrl).toMatch(/^https:\/\/cdn\.bsky\.app\//);
    expect(item.publishedAt.toISOString()).toBe("2026-10-22T18:49:13.949Z");
    expect(item.contentHtml).toMatch(/^<p>/);
    expect(item.contentHtml).toContain('rel="nofollow noopener noreferrer"');
    expect(embedOf(item)?.link).toMatchObject({
      url: "https://atproto.com/blog/atmospheric-groups-intro",
      title: "An Intro to Atmospheric Groups",
      description: "Atmospheric Groups, part of the Spaces blog series",
    });
    expect(embedOf(item)?.link?.thumb).toMatch(/^https:\/\/cdn\.bsky\.app\//);
    expect(embedOf(item)?.quote).toBeUndefined();
  });

  it("keeps the AppView entry as received in raw", () => {
    const entry = recordedEntry(DIDS.atproto, "3myidcyrgv22f");
    expect((map(entry).raw as BlueskyRaw).feedViewPost).toEqual(entry);
  });
});

describe("facets", () => {
  it("links byte ranges after multi-byte characters, mentions and hashtags; escapes the rest", () => {
    // "café 👋 " is 11 bytes in UTF-8 (é 2, 👋 4).
    const text = "café 👋 example.org <b>hi</b>\n\n@bsky.app #river";
    const at = (s: string) => Buffer.byteLength(text.slice(0, text.indexOf(s)), "utf8");
    const span = (s: string) => ({ byteStart: at(s), byteEnd: at(s) + Buffer.byteLength(s, "utf8") });
    const html = postHtml(text, [
      { index: span("example.org"), features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.org/" }] },
      { index: span("@bsky.app"), features: [{ $type: "app.bsky.richtext.facet#mention", did: DIDS.bskyApp }] },
      { index: span("#river"), features: [{ $type: "app.bsky.richtext.facet#tag", tag: "river" }] },
    ]);
    expect(html).toBe(
      '<p>café 👋 <a href="https://example.org/" rel="nofollow noopener noreferrer">example.org</a> &lt;b&gt;hi&lt;/b&gt;</p>' +
        `<p><a href="https://bsky.app/profile/${DIDS.bskyApp}" rel="nofollow noopener noreferrer">@bsky.app</a> ` +
        '<a href="https://bsky.app/hashtag/river" rel="nofollow noopener noreferrer">#river</a></p>',
    );
  });

  it("keeps the text of a link that isn't https, and skips out-of-range and overlapping facets", () => {
    const text = "see javascript:alert(1) and more";
    const html = postHtml(text, [
      { index: { byteStart: 4, byteEnd: 23 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "javascript:alert(1)" }] },
      { index: { byteStart: 0, byteEnd: 999 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://a.example/" }] },
      { index: { byteStart: 0, byteEnd: 3 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://b.example/" }] },
      { index: { byteStart: 1, byteEnd: 5 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://c.example/" }] },
    ]);
    expect(html).toBe('<p><a href="https://b.example/" rel="nofollow noopener noreferrer">see</a> javascript:alert(1) and more</p>');
  });
});

describe("photos and video", () => {
  it("images become a photo with their alt text and proportions", () => {
    const item = map(recordedEntry(DIDS.publicDomainReview, "3mycz764vys2q"));
    expect(item.kind).toBe("photo");
    expect(item.media).toHaveLength(1);
    expect(item.media[0]).toMatchObject({ type: "image" });
    expect(item.media[0]?.url).toMatch(/^https:\/\/cdn\.bsky\.app\/img\/feed_fullsize\//);
    expect(item.media[0]?.alt).toMatch(/^Three tall stacks of PDR Press Mini paperbacks/);
  });

  it("a gallery is a photo too, every image with its alt text", () => {
    const item = map(recordedEntry(DIDS.wikipedia, "3mykfnof5ws2n"));
    expect(item.kind).toBe("photo");
    expect(item.media).toHaveLength(5);
    expect(item.media.every((m) => m.type === "image" && m.url.startsWith("https://") && m.alt)).toBe(true);
    expect(item.media[0]).toMatchObject({ width: 1080, height: 1440 });
  });

  it("a video is a video whose media is its thumbnail only (no HLS player)", () => {
    const item = map(recordedEntry(DIDS.bskyApp, "3myi3k45jh22z"));
    expect(item.kind).toBe("video");
    expect(item.media).toEqual([
      expect.objectContaining({
        type: "image",
        url: expect.stringMatching(/^https:\/\/video\.bsky\.app\/watch\/.+\/thumbnail\.jpg$/),
        alt: "Welcome screen of the Bluesky app displayed on an iPad, floating against a blue sky with clouds",
      }),
    ]);
    expect(item.media.some((m) => m.url.endsWith(".m3u8"))).toBe(false);
    expect(item.url).toBe(`https://bsky.app/profile/${DIDS.bskyApp}/post/3myi3k45jh22z`);
  });
});

describe("quotes", () => {
  it("a quote post keeps the quoted post: author, text, time and link", () => {
    const item = map(recordedEntry(DIDS.bskyApp, "3mycyypdrxc2s"));
    expect(item.kind).toBe("post");
    const quote = embedOf(item)?.quote;
    expect(quote).toMatchObject({
      url: "https://bsky.app/profile/did:plc:yn75hmwkitdshnylue6d3grk/post/3mycywfduwb2p",
      author: { handle: "@niedermeyer.online", url: "https://bsky.app/profile/did:plc:yn75hmwkitdshnylue6d3grk" },
    });
    expect(quote?.text).toMatch(/^🔴 LIVE https:\/\/stream\.place\/niedermeyer\.online Elon Take The Wheel/);
    expect(quote?.publishedAt).toMatch(/^2026-10-20T/);
  });

  it("a quote with media: the images are the post's, the quoted post is kept", () => {
    const item = map(recordedEntry(DIDS.bskyApp, "3mxkszxasyy2f"));
    expect(item.kind).toBe("photo");
    expect(item.media.length).toBeGreaterThan(0);
    expect(embedOf(item)?.quote?.author?.handle).toBe("@robdogdraws.bsky.social");
  });

  it("a quoted post that can't be shown says so", () => {
    expect(embedOf(map(recordedEntry(DIDS.bskyApp, "3myaytlknus25")))?.quote).toEqual({ unavailable: true });
  });

  it("a quoted starter pack is not a post: the item is plain text", () => {
    const item = map(recordedEntry(DIDS.bskyApp, "3mwolmfws5k2r"));
    expect(embedOf(item)).toBeUndefined();
  });

  it("DERIVED: a deleted quoted post is unavailable", () => {
    const entry = recordedEntry(DIDS.bskyApp, "3mycyypdrxc2s");
    const post = entry.post as { embed: { record: unknown } };
    post.embed.record = { $type: "app.bsky.embed.record#viewNotFound", uri: "at://did:plc:x/app.bsky.feed.post/y", notFound: true };
    expect(embedOf(map(entry))?.quote).toEqual({ unavailable: true });
  });
});

describe("reposts", () => {
  it("a repost is a boost card: the repost's id, time and reposter, the original author in boost_of", () => {
    const item = map(recordedEntry(DIDS.bskyApp, "3myko2d3dz726"));
    expect(item).toMatchObject({
      sourceId: `at://${DIDS.bskyApp}/app.bsky.feed.repost/3myko2d3dz726`,
      kind: "video",
      url: "https://bsky.app/profile/did:plc:2jspkem5l66pgvdhkcibmh3d/post/3mykmsu7tnc23",
      author: { name: "Bluesky", handle: "@bsky.app" },
      boostOf: {
        objectId: "at://did:plc:2jspkem5l66pgvdhkcibmh3d/app.bsky.feed.post/3mykmsu7tnc23",
        host: "bsky.app",
        url: "https://bsky.app/profile/did:plc:2jspkem5l66pgvdhkcibmh3d/post/3mykmsu7tnc23",
        author: { name: "Oregon Zoo", handle: "@oregonzoo.bsky.social" },
        fetched: true,
      },
      hidden: false,
    });
    expect(item.publishedAt.toISOString()).toBe("2026-10-23T17:06:33.547Z");
  });

  it("hides a repost of someone who asked not to be shown to signed-out readers", () => {
    expect(map(recordedEntry(DIDS.bskyApp, "3myiilowikk2p")).hidden).toBe(true);
  });

  it("DERIVED: a repost of a reply is shown", () => {
    const entry = recordedEntry(DIDS.bskyApp, "3myko2d3dz726");
    const record = (entry.post as { record: Record<string, unknown> }).record;
    record.reply = { root: { uri: "at://x", cid: "y" }, parent: { uri: "at://x", cid: "y" } };
    expect(map(entry).hidden).toBe(false);
  });
});

describe("what stays hidden", () => {
  it("DERIVED: a reply is hidden", () => {
    const entry = recordedEntry(DIDS.atproto, "3myidcyrgv22f");
    const record = (entry.post as { record: Record<string, unknown> }).record;
    record.reply = { root: { uri: "at://x", cid: "y" }, parent: { uri: "at://x", cid: "y" } };
    expect(map(entry).hidden).toBe(true);
  });

  it.each(["porn", "sexual", "nudity", "graphic-media"])("DERIVED: a post labelled %s is hidden; a negated label isn't", (val) => {
    const entry = recordedEntry(DIDS.publicDomainReview, "3mycz764vys2q");
    const post = entry.post as { labels?: unknown[] };
    post.labels = [{ src: DIDS.publicDomainReview, uri: "at://x", val, cts: "2026-10-20T00:00:00Z" }];
    expect(map(entry).hidden).toBe(true);
    post.labels = [{ src: DIDS.publicDomainReview, uri: "at://x", val, neg: true, cts: "2026-10-20T00:00:00Z" }];
    expect(map(entry).hidden).toBe(false);
  });

  it("DERIVED: a pinned-post reason and a record that isn't a post are not items", () => {
    const pinned = recordedEntry(DIDS.atproto, "3myidcyrgv22f");
    pinned.reason = { $type: "app.bsky.feed.defs#reasonPin" };
    expect(mapFeedEntry(pinned, { now: BSKY_NOW })).toBeUndefined();
    const other = recordedEntry(DIDS.atproto, "3myidcyrgv22f");
    (other.post as { record: Record<string, unknown> }).record.$type = "app.bsky.feed.like";
    expect(mapFeedEntry(other, { now: BSKY_NOW })).toBeUndefined();
  });

  it("DERIVED: a createdAt after the AppView indexed the post is not believed", () => {
    const entry = recordedEntry(DIDS.atproto, "3myidcyrgv22f");
    const post = entry.post as { record: Record<string, unknown>; indexedAt: string };
    post.record.createdAt = "2030-01-01T00:00:00Z";
    expect(map(entry).publishedAt.toISOString()).toBe(new Date(post.indexedAt).toISOString());
  });
});

describe("every recorded entry", () => {
  it("maps to an item with an https bsky.app URL, https media, and sanitized HTML", () => {
    let count = 0;
    for (const did of Object.values(DIDS)) {
      for (const entry of recordedEntries(did)) {
        const item = mapFeedEntry(entry, { now: BSKY_NOW });
        if (!item) continue;
        count++;
        expect(item.url).toMatch(/^https:\/\/bsky\.app\/profile\/did:plc:[a-z2-7]{24}\/post\//);
        for (const m of item.media) expect(m.url).toMatch(/^https:\/\//);
        expect(item.contentHtml ?? "").not.toMatch(/<(?!\/?(p|br|a)\b)/);
      }
    }
    expect(count).toBeGreaterThan(200);
  });
});

describe("readEmbed", () => {
  it("reads back a stored link card and quote, dropping anything that isn't https or plain", () => {
    expect(
      readEmbed({
        link: { url: "javascript:alert(1)", title: "x" },
        quote: {
          url: "https://bsky.app/profile/did:plc:x/post/y",
          text: "hello",
          author: { name: "A", handle: "@a.bsky.social", url: "http://insecure.example/", iconUrl: "https://cdn.bsky.app/a.jpg" },
          media: [{ url: "data:image/png;base64,AAAA" }, { url: "https://cdn.bsky.app/i.jpg", alt: "an image" }],
          publishedAt: "not a date",
        },
      }),
    ).toEqual({
      quote: {
        url: "https://bsky.app/profile/did:plc:x/post/y",
        text: "hello",
        author: { name: "A", handle: "@a.bsky.social", iconUrl: "https://cdn.bsky.app/a.jpg" },
        media: [{ type: "image", url: "https://cdn.bsky.app/i.jpg", alt: "an image" }],
      },
    });
    expect(readEmbed(undefined)).toBeUndefined();
    expect(readEmbed({ quote: { unavailable: true } })).toEqual({ quote: { unavailable: true } });
  });
});
