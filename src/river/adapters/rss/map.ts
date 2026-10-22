// Feed entries to items (spec 3.1, ADR-003, ADR-007):
//
// - an audio enclosure (RSS <enclosure>, Atom rel="enclosure", Media RSS) makes a `podcast`;
//   otherwise a video enclosure makes a `video`; otherwise an entry with a title is an `article`
//   and one without is a `post`;
// - itunes:duration (seconds, MM:SS or HH:MM:SS) or Media RSS `duration` goes on the audio or
//   video media entry, in seconds;
// - the episode's image (itunes:image, media:thumbnail), else a podcast's cover art, is an image
//   media entry; only https files are kept (spec 4.8);
// - HTML goes through sanitize(); titles and summaries through toPlainText();
// - the item URL is the entry's link, else a permalink guid, else the media file; only https.
import { createHash } from "node:crypto";
import type { ItemKind, MediaRef, NormalizedItem } from "../../../shared/items/index.js";
import { sanitize, toPlainText } from "../../../shared/sanitize/index.js";
import type { FeedEnclosure, FeedEntry, ParsedFeed } from "./feed.js";

const AUDIO_EXTENSIONS = /\.(?:mp3|m4a|aac|oga|ogg|opus|wav|flac)(?:$|[?#])/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|m4v|webm|mov|ogv)(?:$|[?#])/i;
const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|gif|webp|avif)(?:$|[?#])/i;

/** Longest source_id kept (a guid can be any string). */
const MAX_ID = 1000;

/**
 * Seconds from itunes:duration: "3725", "62:05" or "1:02:05" (fractions allowed). Undefined for
 * anything else, including negative or empty values.
 */
export function parseDuration(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text));
  const parts = /^(?:(\d+):)?(\d{1,4}):(\d{1,2}(?:\.\d+)?)$/.exec(text);
  if (!parts) return undefined;
  const [, h, m, s] = parts;
  if (Number(m) >= 60 && h !== undefined) return undefined;
  if (Number(s) >= 60) return undefined;
  return Math.round(Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s));
}

/** An https URL, resolved against `base` when relative; undefined otherwise. */
export function httpsLink(value: string | undefined, base?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = base ? new URL(value.trim(), base) : new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** A date from RFC 822 (RSS), RFC 3339 (Atom) or ISO 8601 (dc:date); undefined if unreadable. */
export function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function mediaKind(e: FeedEnclosure): MediaRef["type"] | undefined {
  const type = e.type ?? "";
  if (type.startsWith("audio/") || e.medium === "audio") return "audio";
  if (type.startsWith("video/") || e.medium === "video") return "video";
  if (type.startsWith("image/") || e.medium === "image") return "image";
  if (type) return undefined;
  if (AUDIO_EXTENSIONS.test(e.url)) return "audio";
  if (VIDEO_EXTENSIONS.test(e.url)) return "video";
  if (IMAGE_EXTENSIONS.test(e.url)) return "image";
  return undefined;
}

function plain(value: string | undefined, max = 500): string | undefined {
  const text = toPlainText(value);
  return text === "" ? undefined : text.slice(0, max);
}

/** The entry's kind and media, from its enclosures. */
function kindAndMedia(entry: FeedEntry, feed: ParsedFeed, base: string): { kind: ItemKind; media: MediaRef[] } {
  const typed = entry.enclosures.map((e) => ({ e, type: mediaKind(e) }));
  const audio = typed.find((t) => t.type === "audio");
  const video = typed.find((t) => t.type === "video");
  const title = plain(entry.title);
  const kind: ItemKind = audio ? "podcast" : video ? "video" : title ? "article" : "post";
  const media: MediaRef[] = [];

  const main = audio ?? video;
  if (main) {
    const url = httpsLink(main.e.url, base);
    const duration = parseDuration(entry.duration) ?? main.e.duration;
    if (url) {
      media.push({
        type: main.type as "audio" | "video",
        url,
        ...(duration !== undefined ? { duration } : {}),
        ...(main.e.width !== undefined ? { width: main.e.width } : {}),
        ...(main.e.height !== undefined ? { height: main.e.height } : {}),
      });
    }
  }

  // The picture: the episode's own image, else an image enclosure, else (podcasts) the cover.
  const imageEnclosure = typed.find((t) => t.type === "image")?.e;
  const picture =
    entry.image ??
    (imageEnclosure ? { url: imageEnclosure.url, width: imageEnclosure.width, height: imageEnclosure.height } : undefined) ??
    // Apple's cover art only (an Atom icon is a favicon, not a picture of the show).
    (kind === "podcast" && feed.itunes && feed.image ? { url: feed.image } : undefined);
  const pictureUrl = httpsLink(picture?.url, base);
  if (picture && pictureUrl) {
    media.push({
      type: "image",
      url: pictureUrl,
      ...(picture.width !== undefined ? { width: picture.width } : {}),
      ...(picture.height !== undefined ? { height: picture.height } : {}),
    });
  }
  return { kind, media };
}

const EMAIL = /[^\s()<>@,;:"]+@[^\s()<>@,;:"]+\.[^\s()<>@,;:"]+/g;

/**
 * An author's name without any email address. RSS 2.0's <author> is an email address with an
 * optional name in parentheses ("editor@example.com (Jo Editor)"); the River never stores email
 * addresses (CLAUDE.md constraint 7), so only the name is kept.
 */
export function authorName(raw: string | undefined): string | undefined {
  const text = plain(raw, 400);
  if (!text) return undefined;
  const inParens = /\(([^)]+)\)/.exec(text)?.[1];
  const name = (inParens ?? text).replace(EMAIL, "").replace(/[<>()]/g, "").replace(/\s+/g, " ").trim();
  return name === "" ? undefined : name.slice(0, 200);
}

function sourceIdOf(entry: FeedEntry, link: string | undefined): string {
  const id = entry.id?.trim();
  if (id) return id.slice(0, MAX_ID);
  if (link) return link.slice(0, MAX_ID);
  // No guid and no link: a stable hash of what the entry says.
  const basis = JSON.stringify([entry.title ?? "", entry.date ?? "", entry.enclosures[0]?.url ?? "", entry.contentHtml ?? ""]);
  return `urn:sha256:${createHash("sha256").update(basis).digest("hex")}`;
}

export interface MapContext {
  /** The feed's own URL, for relative links. */
  feedUrl: string;
  /** Fallback publish time for undated entries. */
  now: Date;
}

/** One entry to an item. Feed items are public by nature, so none is hidden. */
export function mapEntry(entry: FeedEntry, feed: ParsedFeed, ctx: MapContext): NormalizedItem {
  const base = httpsLink(feed.link, ctx.feedUrl) ?? ctx.feedUrl;
  const link = httpsLink(entry.link, base) ?? (entry.idIsLink ? httpsLink(entry.id) : undefined);
  const { kind, media } = kindAndMedia(entry, feed, base);
  const fileUrl = media.find((m) => m.type === "audio" || m.type === "video")?.url;
  const contentHtml = sanitize(entry.contentHtml) || undefined;
  const author = authorName(entry.author);
  const item: NormalizedItem = {
    sourceId: sourceIdOf(entry, link),
    kind,
    publishedAt: parseDate(entry.date) ?? ctx.now,
    title: plain(entry.title, 300),
    summary: contentHtml ? undefined : plain(entry.summaryText),
    contentHtml,
    url: link ?? fileUrl,
    author: author ? { name: author } : undefined,
    media,
    isFinalResult: false,
    hidden: false,
    // What the feed said, minus any email address in the author (constraint 7).
    raw: { entry: { ...entry, author } },
  };
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)) as unknown as NormalizedItem;
}
