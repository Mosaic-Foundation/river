// The feed adapter's reading and mapping (M12, ADR-007): the lenient XML reader, RSS 2.0, RSS 1.0
// and Atom, Apple's podcast tags, durations, enclosures, sanitizing, email addresses in authors and
// malformed feeds. Feeds here are written inline to the published formats; nothing is fetched.
import { describe, expect, it } from "vitest";
import {
  authorName,
  looksLikeFeed,
  mapEntry,
  MAX_ENTRIES,
  parseDuration,
  parseFeed,
  parseXml,
  XmlError,
} from "../../src/river/adapters/rss/index.js";
import { discoverFeeds, looksLikeHtml } from "../../src/river/adapters/rss/discover.js";

const NOW = new Date("2026-10-21T00:00:00Z");
const FEED_URL = "https://feeds.test.example/show.xml";

function rss(items: string, channel = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Test Show</title><link>https://show.test.example/</link><description>About</description>${channel}
${items}
</channel></rss>`;
}

function mapOne(xml: string) {
  const feed = parseFeed(xml);
  if (!feed) throw new Error("not a feed");
  const entry = feed.entries[0];
  if (!entry) throw new Error("no entry");
  return mapEntry(entry, feed, { feedUrl: FEED_URL, now: NOW });
}

describe("itunes:duration", () => {
  it.each([
    ["1800", 1800],
    ["00:42:15", 2535],
    ["1:05:30", 3930],
    ["42:15", 2535],
    ["123:45", 7425],
    ["7:05", 425],
    ["3600.4", 3600],
    ["0:59.6", 60],
    [" 90 ", 90],
  ])("reads %j as %i seconds", (text, seconds) => {
    expect(parseDuration(text)).toBe(seconds);
  });

  it.each(["", "abc", "-5", "1:2:3:4", "1:75:00", "10:61", "PT4M33S", "1h"])("rejects %j", (text) => {
    expect(parseDuration(text)).toBeUndefined();
  });
});

describe("the XML reader", () => {
  it("reads CDATA, entities and numeric references, and canonical prefixes", () => {
    const root = parseXml(
      '<?xml version="1.0"?><!-- c --><r xmlns:i="http://www.itunes.com/dtds/podcast-1.0.dtd"><i:duration>5</i:duration><t>A &amp; B &#233; &#x263A; <![CDATA[<b>raw</b>]]></t></r>',
    );
    expect(root.name).toBe("r");
    expect(root.children.map((c) => (typeof c === "string" ? c : c.name))).toEqual(["itunes:duration", "t"]);
    const t = root.children[1];
    expect(typeof t !== "string" && t.children).toEqual(["A & B é ☺ <b>raw</b>"]);
  });

  it("refuses a document that declares entities (no expansion, no external entities)", () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><r>&b;</r>';
    expect(() => parseXml(bomb)).toThrow(XmlError);
    const external = '<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>';
    expect(() => parseXml(external)).toThrow(XmlError);
    expect(parseFeed(external)).toBeUndefined();
  });

  it("keeps going past sloppy markup: a stray ampersand, a stray <, an unclosed tag", () => {
    const root = parseXml("<r><a>Tom & Jerry</a><b>1 < 2</b><c>open<d>x</d></r>");
    const names = root.children.filter((c) => typeof c !== "string").map((c) => (c as { name: string }).name);
    expect(names).toEqual(["a", "b", "c"]);
  });

  it("refuses runaway nesting", () => {
    expect(() => parseXml("<a>".repeat(200))).toThrow(XmlError);
  });
});

describe("RSS 2.0 podcast items", () => {
  const episode = `<item>
    <title>Episode 3: Libraries &amp; after dark</title>
    <link>https://show.test.example/episodes/3</link>
    <guid isPermaLink="false">ep-3</guid>
    <pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate>
    <author>hosts@show.test.example (Ana Ruiz)</author>
    <content:encoded><![CDATA[<p>Night <strong>shift</strong>.</p><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">x</a><a href="https://show.test.example/notes">notes</a>]]></content:encoded>
    <enclosure url="https://cdn.test.example/ep3.mp3" length="40560000" type="audio/mpeg"/>
    <itunes:duration>00:42:15</itunes:duration>
    <itunes:image href="https://cdn.test.example/ep3.jpg"/>
  </item>`;

  it("maps an audio enclosure to a podcast with its duration and episode image", () => {
    const item = mapOne(rss(episode));
    expect(item).toMatchObject({
      sourceId: "ep-3",
      kind: "podcast",
      title: "Episode 3: Libraries & after dark",
      url: "https://show.test.example/episodes/3",
      publishedAt: new Date("2026-10-20T09:00:00Z"),
      hidden: false,
      isFinalResult: false,
    });
    expect(item.media).toEqual([
      { type: "audio", url: "https://cdn.test.example/ep3.mp3", duration: 2535 },
      { type: "image", url: "https://cdn.test.example/ep3.jpg" },
    ]);
  });

  it("sanitizes content: no script, onerror, javascript: or img; https links kept with rel", () => {
    const item = mapOne(rss(episode));
    expect(item.contentHtml).not.toMatch(/<script|alert|onerror|javascript:|<img/i);
    expect(item.contentHtml).toContain("<strong>shift</strong>");
    expect(item.contentHtml).toContain('<a href="https://show.test.example/notes" rel="nofollow noopener noreferrer">notes</a>');
  });

  it("keeps the author's name and never an email address, in the item or its raw copy", () => {
    const item = mapOne(rss(episode));
    expect(item.author).toEqual({ name: "Ana Ruiz" });
    expect(JSON.stringify(item)).not.toContain("hosts@show.test.example");
    expect(authorName("editor@example.org")).toBeUndefined();
    expect(authorName("Jo Editor <jo@example.org>")).toBe("Jo Editor");
  });

  it("uses the podcast's cover when an episode has no image", () => {
    const item = mapOne(
      rss(
        `<item><title>Ep</title><guid>g</guid><enclosure url="https://cdn.test.example/a.mp3" type="audio/mpeg" length="1"/><itunes:duration>61</itunes:duration></item>`,
        `<itunes:image href="https://cdn.test.example/cover.jpg"/>`,
      ),
    );
    expect(item.media).toEqual([
      { type: "audio", url: "https://cdn.test.example/a.mp3", duration: 61 },
      { type: "image", url: "https://cdn.test.example/cover.jpg" },
    ]);
  });

  it("recognizes audio by extension when the enclosure has no type", () => {
    const item = mapOne(rss(`<item><title>Ep</title><enclosure url="https://cdn.test.example/a.m4a?x=1"/></item>`));
    expect(item.kind).toBe("podcast");
  });

  it("keeps the kind but drops an http media file or image (spec 4.8: https only)", () => {
    const item = mapOne(
      rss(
        `<item><title>Ep</title><link>https://show.test.example/e</link><enclosure url="http://cdn.test.example/a.mp3" type="audio/mpeg"/><itunes:image href="http://cdn.test.example/a.jpg"/></item>`,
      ),
    );
    expect(item.kind).toBe("podcast");
    expect(item.media).toEqual([]);
  });

  it("links to the media file when an episode has no link or permalink guid", () => {
    const item = mapOne(rss(`<item><title>Ep</title><guid isPermaLink="false">x</guid><enclosure url="https://cdn.test.example/a.mp3" type="audio/mpeg"/></item>`));
    expect(item.url).toBe("https://cdn.test.example/a.mp3");
  });

  it("uses a permalink guid as the URL", () => {
    const item = mapOne(rss(`<item><title>T</title><guid>https://show.test.example/p/1</guid></item>`));
    expect(item).toMatchObject({ sourceId: "https://show.test.example/p/1", url: "https://show.test.example/p/1" });
  });
});

describe("other RSS items", () => {
  it("a video enclosure (Media RSS) makes a video with its duration and thumbnail", () => {
    const item = mapOne(
      rss(
        `<item><title>Clip</title><link>https://show.test.example/c</link><media:group><media:content url="https://cdn.test.example/c.mp4" type="video/mp4" duration="95" width="1280" height="720"/><media:thumbnail url="https://cdn.test.example/c.jpg" width="640" height="360"/></media:group></item>`,
      ),
    );
    expect(item.kind).toBe("video");
    expect(item.media).toEqual([
      { type: "video", url: "https://cdn.test.example/c.mp4", duration: 95, width: 1280, height: 720 },
      { type: "image", url: "https://cdn.test.example/c.jpg", width: 640, height: 360 },
    ]);
  });

  it("a titled item without media is an article; an untitled one is a post", () => {
    const article = mapOne(rss(`<item><title>News &lt;b&gt;today&lt;/b&gt;</title><link>/a/1</link><description>&lt;p&gt;Hello&lt;/p&gt;</description></item>`));
    expect(article).toMatchObject({ kind: "article", title: "News today", contentHtml: "<p>Hello</p>" });
    // A relative link resolves against the site the channel names.
    expect(article.url).toBe("https://show.test.example/a/1");
    const post = mapOne(rss(`<item><description>Just a short note</description><guid>n1</guid></item>`));
    expect(post).toMatchObject({ kind: "post", contentHtml: "Just a short note" });
    expect(post.title).toBeUndefined();
  });

  it("an undated item takes now; an unreadable date too", () => {
    expect(mapOne(rss(`<item><title>T</title><guid>a</guid></item>`)).publishedAt).toEqual(NOW);
    expect(mapOne(rss(`<item><title>T</title><guid>a</guid><pubDate>someday</pubDate></item>`)).publishedAt).toEqual(NOW);
  });

  it("an item with no guid or link gets a stable hashed id", () => {
    const xml = rss(`<item><title>Same</title><pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate></item>`);
    const a = mapOne(xml);
    expect(a.sourceId).toMatch(/^urn:sha256:[0-9a-f]{64}$/);
    expect(mapOne(xml).sourceId).toBe(a.sourceId);
  });

  it("reads at most MAX_ENTRIES entries", () => {
    const many = Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => `<item><guid>g${i}</guid><title>t</title></item>`).join("");
    expect(parseFeed(rss(many))?.entries).toHaveLength(MAX_ENTRIES);
  });
});

describe("RSS 1.0 and Atom", () => {
  it("reads RSS 1.0 (RDF) items", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://old.test.example/"><title>Old Site</title><link>https://old.test.example/</link></channel>
  <item rdf:about="https://old.test.example/1"><title>First</title><link>https://old.test.example/1</link><dc:date>2026-10-01T10:00:00Z</dc:date></item>
</rdf:RDF>`);
    expect(feed).toMatchObject({ format: "rss", title: "Old Site" });
    const item = mapEntry(feed!.entries[0]!, feed!, { feedUrl: FEED_URL, now: NOW });
    expect(item).toMatchObject({ kind: "article", sourceId: "https://old.test.example/1", publishedAt: new Date("2026-10-01T10:00:00Z") });
  });

  it("reads an Atom feed: alternate links, html and xhtml content, enclosures, author", () => {
    const feed = parseFeed(`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Atom Blog</title>
  <link href="https://blog.test.example/"/>
  <link rel="self" href="https://blog.test.example/atom.xml"/>
  <icon>https://blog.test.example/icon.png</icon>
  <id>urn:uuid:60a76c80-d399-11d9-b93C-0003939e0af6</id>
  <updated>2026-10-18T18:30:02Z</updated>
  <entry>
    <title type="html">Hello &lt;em&gt;world&lt;/em&gt;</title>
    <link href="https://blog.test.example/2026/hello"/>
    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
    <published>2026-10-18T18:30:02Z</published>
    <author><name>Kim</name><email>kim@blog.test.example</email></author>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Some <strong>xhtml</strong> &amp; text</p><script>alert(1)</script></div></content>
  </entry>
  <entry>
    <title>Show 9</title>
    <link rel="alternate" href="/shows/9"/>
    <link rel="enclosure" type="audio/ogg" href="https://blog.test.example/9.ogg" length="1"/>
    <id>tag:blog.test.example,2026:9</id>
    <updated>2026-10-10T00:00:00Z</updated>
    <summary>Plain &lt;text&gt; summary</summary>
  </entry>
</feed>`);
    expect(feed).toMatchObject({ format: "atom", title: "Atom Blog", link: "https://blog.test.example/", image: "https://blog.test.example/icon.png" });
    const [first, second] = feed!.entries.map((e) => mapEntry(e, feed!, { feedUrl: "https://blog.test.example/atom.xml", now: NOW }));
    expect(first).toMatchObject({
      kind: "article",
      title: "Hello world",
      url: "https://blog.test.example/2026/hello",
      author: { name: "Kim" },
      publishedAt: new Date("2026-10-18T18:30:02Z"),
    });
    expect(first!.contentHtml).toBe("<p>Some <strong>xhtml</strong> &amp; text</p>");
    expect(JSON.stringify(first)).not.toContain("kim@blog.test.example");
    expect(second).toMatchObject({ kind: "podcast", url: "https://blog.test.example/shows/9", contentHtml: "Plain &lt;text&gt; summary" });
    expect(second!.media).toEqual([{ type: "audio", url: "https://blog.test.example/9.ogg" }]);
  });
});

describe("malformed and non-feeds", () => {
  it.each([
    ["an HTML page", "<!doctype html><html><head><title>x</title></head></html>"],
    ["JSON", '{"version":"https://jsonfeed.org/version/1.1"}'],
    ["empty text", ""],
    ["an XML document of another kind", '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ["an rss element with no channel", "<rss version=\"2.0\"></rss>"],
  ])("%s is not a feed", (_label, text) => {
    expect(parseFeed(text)).toBeUndefined();
  });

  it("a truncated feed still yields the items it holds", () => {
    const text = rss(`<item><title>One</title><guid>1</guid></item><item><title>Two</title><guid>2</guid>`).slice(0, -30);
    expect(parseFeed(text)?.entries.map((e) => e.title)).toEqual(["One", "Two"]);
  });

  it("looksLikeFeed spots RSS, Atom and RDF roots after a prolog", () => {
    expect(looksLikeFeed('﻿<?xml version="1.0"?>\n<!-- hi -->\n<rss version="2.0">')).toBe(true);
    expect(looksLikeFeed('<feed xmlns="http://www.w3.org/2005/Atom">')).toBe(true);
    expect(looksLikeFeed("<rdf:RDF>")).toBe(true);
    expect(looksLikeFeed("<html>")).toBe(false);
  });
});

describe("feed autodiscovery", () => {
  it("finds rss and atom alternates, resolves them and keeps https only", () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="/s.css">
      <link rel="alternate" type="application/rss+xml" title="Podcast" href="/feed.xml">
      <link type="application/atom+xml" href="https://other.test.example/atom.xml" rel="alternate">
      <link rel="alternate" type="application/rss+xml" href="http://insecure.test.example/feed">
      <link rel="alternate" type="application/feed+json" href="/feed.json">
      <link rel="alternate" hreflang="fr" href="/fr/">
    </head></html>`;
    expect(discoverFeeds(html, "https://site.test.example/page")).toEqual([
      "https://site.test.example/feed.xml",
      "https://other.test.example/atom.xml",
    ]);
  });

  it("tells pages from feeds", () => {
    expect(looksLikeHtml("text/html; charset=utf-8", "<rss>")).toBe(true);
    expect(looksLikeHtml(null, "  <!DOCTYPE html><html>")).toBe(true);
    expect(looksLikeHtml("application/rss+xml", "<rss>")).toBe(false);
  });
});
