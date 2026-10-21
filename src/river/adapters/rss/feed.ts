// Reads a parsed feed document into one shape for RSS 2.0 (and 0.9x), RSS 1.0 (RDF) and Atom
// (RFC 4287), with the podcast parts of Apple's namespace (`itunes:`) and Media RSS (`media:`).
// Nothing here fetches, sanitizes or decides kinds: map.ts does that.
//
// Specs followed: RSS 2.0 (https://www.rssboard.org/rss-specification), Atom (RFC 4287), Apple
// Podcasts' RSS tags (https://podcasters.apple.com/support/823-podcast-requirements), Media RSS
// (https://www.rssboard.org/media-rss).
import {
  child,
  childrenNamed,
  descendants,
  elements,
  innerMarkup,
  parseXml,
  textOf,
  XmlError,
  type XmlElement,
} from "./xml.js";

export type FeedFormat = "rss" | "atom";

export interface FeedEnclosure {
  url: string;
  /** MIME type as the feed gives it, lowercased. */
  type?: string;
  /** Media RSS `medium` (audio, video, image). */
  medium?: string;
  /** Seconds, when the feed gives it on the enclosure (Media RSS `duration`). */
  duration?: number;
  width?: number;
  height?: number;
}

export interface FeedImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface FeedEntry {
  /** guid (RSS) or id (Atom), as written. */
  id?: string;
  /** RSS guid isPermaLink (default true when a guid is present). */
  idIsLink: boolean;
  /** Raw title text; may hold escaped HTML (RSS) or be html-typed (Atom). */
  title?: string;
  link?: string;
  /** pubDate / dc:date / published / updated, as written. */
  date?: string;
  /** HTML (content:encoded, description, Atom content or summary). Untrusted. */
  contentHtml?: string;
  /** Plain text (itunes:summary or itunes:subtitle). */
  summaryText?: string;
  author?: string;
  enclosures: FeedEnclosure[];
  /** itunes:duration, as written (seconds, MM:SS or HH:MM:SS). */
  duration?: string;
  /** The episode's own image (itunes:image) or Media RSS thumbnail. */
  image?: FeedImage;
}

export interface ParsedFeed {
  format: FeedFormat;
  title?: string;
  /** The site the feed belongs to. */
  link?: string;
  description?: string;
  /** itunes:image, RSS image/url, Atom icon or logo. */
  image?: string;
  /** True when the channel uses Apple's podcast namespace. */
  itunes: boolean;
  entries: FeedEntry[];
}

/** Most entries read from one feed (newest are usually first; map.ts sorts anyway). */
export const MAX_ENTRIES = 200;

function attr(el: XmlElement | undefined, name: string): string | undefined {
  const value = el?.attrs[name]?.trim();
  return value ? value : undefined;
}

function number(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** True when the text starts like a feed document (after any XML prolog, comments or doctype). */
export function looksLikeFeed(text: string): boolean {
  const head = text
    .slice(0, 4096)
    .replace(/^﻿/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .trimStart();
  return /^<(?:[\w-]+:)?(?:rss|feed|RDF)[\s>]/.test(head);
}

/** Parses a feed; undefined when the document isn't RSS or Atom. Throws XmlError on refused XML. */
export function parseFeed(text: string): ParsedFeed | undefined {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (err) {
    if (err instanceof XmlError) return undefined;
    throw err;
  }
  if (root.name === "rss") return readRss(child(root, "channel"), childrenNamed(child(root, "channel"), "item"));
  if (root.name === "rdf:RDF") return readRss(child(root, "channel"), childrenNamed(root, "item"));
  if (root.name === "atom:feed") return readAtom(root);
  return undefined;
}

// --- Media RSS and Apple's tags, shared by both formats ---

function mediaContents(el: XmlElement): FeedEnclosure[] {
  return descendants(el, "media:content").flatMap((c): FeedEnclosure[] => {
    const url = attr(c, "url");
    if (!url) return [];
    return [
      {
        url,
        type: attr(c, "type")?.toLowerCase(),
        medium: attr(c, "medium")?.toLowerCase(),
        duration: number(attr(c, "duration")),
        width: number(attr(c, "width")),
        height: number(attr(c, "height")),
      },
    ];
  });
}

function entryImage(el: XmlElement): FeedImage | undefined {
  const itunes = attr(child(el, "itunes:image"), "href");
  if (itunes) return { url: itunes };
  const thumb = descendants(el, "media:thumbnail")[0];
  const url = attr(thumb, "url");
  if (thumb && url) return { url, width: number(attr(thumb, "width")), height: number(attr(thumb, "height")) };
  return undefined;
}

// --- RSS 2.0, 0.9x and 1.0 ---

function readRss(channel: XmlElement | undefined, items: XmlElement[]): ParsedFeed | undefined {
  if (!channel) return undefined;
  const itunes =
    elements(channel).some((c) => c.name.startsWith("itunes:")) ||
    items.some((item) => elements(item).some((c) => c.name.startsWith("itunes:")));
  return {
    format: "rss",
    title: textOf(child(channel, "title")),
    link: textOf(child(channel, "link")),
    description: textOf(child(channel, "description")) ?? textOf(child(channel, "itunes:summary")),
    image: attr(child(channel, "itunes:image"), "href") ?? textOf(child(child(channel, "image"), "url")),
    itunes,
    entries: items.slice(0, MAX_ENTRIES).map(readRssItem),
  };
}

function readRssItem(item: XmlElement): FeedEntry {
  const guid = child(item, "guid");
  const enclosures = childrenNamed(item, "enclosure").flatMap((e): FeedEnclosure[] => {
    const url = attr(e, "url");
    return url ? [{ url, type: attr(e, "type")?.toLowerCase() }] : [];
  });
  return {
    id: textOf(guid) ?? attr(item, "rdf:about"),
    idIsLink: guid ? attr(guid, "isPermaLink")?.toLowerCase() !== "false" : false,
    title: textOf(child(item, "title")) ?? textOf(child(item, "itunes:title")),
    link: textOf(child(item, "link")),
    date: textOf(child(item, "pubDate")) ?? textOf(child(item, "dc:date")),
    contentHtml: textOf(child(item, "content:encoded")) ?? textOf(child(item, "description")),
    summaryText: textOf(child(item, "itunes:summary")) ?? textOf(child(item, "itunes:subtitle")),
    author: textOf(child(item, "dc:creator")) ?? textOf(child(item, "itunes:author")) ?? textOf(child(item, "author")),
    enclosures: [...enclosures, ...mediaContents(item)],
    duration: textOf(child(item, "itunes:duration")),
    image: entryImage(item),
  };
}

// --- Atom ---

/** An Atom link's href for a rel ("alternate" is the default rel). */
function atomLink(el: XmlElement, rel: string): XmlElement | undefined {
  return childrenNamed(el, "atom:link").find((l) => (attr(l, "rel") ?? "alternate") === rel && attr(l, "href"));
}

/** Atom text constructs (title, summary, content) as HTML; plain text is escaped. */
function atomHtml(el: XmlElement | undefined): string | undefined {
  if (!el) return undefined;
  const type = (attr(el, "type") ?? "text").toLowerCase();
  if (type === "xhtml") {
    const div = elements(el).find((c) => c.local === "div");
    const markup = innerMarkup(div ?? el).trim();
    return markup || undefined;
  }
  const text = textOf(el);
  if (text === undefined) return undefined;
  if (type === "html" || type === "text/html") return text;
  return text.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function readAtom(feed: XmlElement): ParsedFeed {
  const entries = childrenNamed(feed, "atom:entry");
  return {
    format: "atom",
    title: textOf(child(feed, "atom:title")),
    link: attr(atomLink(feed, "alternate"), "href"),
    description: textOf(child(feed, "atom:subtitle")),
    image: attr(child(feed, "itunes:image"), "href") ?? textOf(child(feed, "atom:logo")) ?? textOf(child(feed, "atom:icon")),
    itunes: elements(feed).some((c) => c.name.startsWith("itunes:")),
    entries: entries.slice(0, MAX_ENTRIES).map((entry) => {
      const enclosures: FeedEnclosure[] = childrenNamed(entry, "atom:link")
        .filter((l) => attr(l, "rel") === "enclosure" && attr(l, "href"))
        .map((l) => ({ url: attr(l, "href") as string, type: attr(l, "type")?.toLowerCase() }));
      const title = child(entry, "atom:title");
      return {
        id: textOf(child(entry, "atom:id")),
        idIsLink: false,
        // An html-typed title is still markup; map.ts turns every title into plain text.
        title: textOf(title),
        link: attr(atomLink(entry, "alternate"), "href"),
        date: textOf(child(entry, "atom:published")) ?? textOf(child(entry, "atom:updated")),
        contentHtml: atomHtml(child(entry, "atom:content")) ?? atomHtml(child(entry, "atom:summary")),
        summaryText: textOf(child(entry, "itunes:summary")) ?? textOf(descendants(entry, "media:description")[0]),
        author: textOf(child(child(entry, "atom:author"), "atom:name")),
        enclosures: [...enclosures, ...mediaContents(entry)],
        duration: textOf(child(entry, "itunes:duration")),
        image: entryImage(entry),
      } satisfies FeedEntry;
    }),
  };
}
