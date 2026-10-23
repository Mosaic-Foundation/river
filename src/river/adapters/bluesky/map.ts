// Bluesky feed entries (app.bsky.feed.getAuthorFeed's `feed[]`, each a FeedViewPost) to items
// (ADR-003, ADR-009 item 4).
//
// - A post is a `post`; with images (`embed.images`, `embed.gallery`) a `photo`, each image a media
//   entry with its alt text; with a video a `video` whose media is the thumbnail only (the
//   playlist is HLS; the card's "Open ↗" plays it on bsky.app).
// - A link card (`embed.external`) and a quoted post (`embed.record`, `embed.recordWithMedia`) are
//   kept as ItemEmbed in `raw.embed`, plain text and https URLs only.
// - A repost (`reason: reasonRepost`) is a boost card under the original author, like a fediverse
//   boost: the repost's id, time and reposter, and `boost_of` naming the post and its author.
//   `fetched` is true: the AppView serves the post itself.
// - Replies are hidden, as on the fediverse; a repost of a reply is shown.
// - Posts labelled as adult content, and posts by accounts that hide from signed-out readers
//   (`!no-unauthenticated`), are stored hidden.
// - Post text is plain text with byte-indexed facets: it is escaped, links, mentions and hashtags
//   become links, and the HTML goes through sanitize() (CLAUDE.md constraint 8).
import { sanitize, toPlainText } from "../../../shared/sanitize/index.js";
import { escapeHtml } from "../text.js";
import type {
  BoostRef,
  ItemAuthor,
  ItemEmbed,
  ItemKind,
  MediaRef,
  NormalizedItem,
  QuotedPost,
} from "../../../shared/items/index.js";
import { httpsUrl, isObject, list, str, type Json } from "./http.js";
import { BSKY_APP, formatHandle, normalizeDid, normalizeHandle, postUrl, profileUrl } from "./input.js";

/** Labels that keep a post out of the feed (ADR-009 item 4). Bluesky's adult-content values. */
export const HIDDEN_LABELS: ReadonlySet<string> = new Set(["porn", "sexual", "nudity", "graphic-media", "!hide", "!takedown"]);
/** An account asking not to be shown to people who aren't signed in to Bluesky. */
export const NO_UNAUTHENTICATED = "!no-unauthenticated";

/** Longest plain text kept for a quoted post, a link card's title and its description. */
const MAX_QUOTE = 1_000;
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 500;

export interface MapContext {
  /** Fallback time for entries without one. */
  now: Date;
}

/** Label values on a post or an account. */
export function labelsOf(value: unknown): string[] {
  if (!isObject(value)) return [];
  return list(value.labels)
    .map((label) => (isObject(label) && label.neg !== true ? str(label.val) : undefined))
    .filter((v): v is string => v !== undefined);
}

/** True when an account's labels ask the River not to show it to signed-out readers. */
export function hidesFromVisitors(profile: unknown): boolean {
  return labelsOf(profile).includes(NO_UNAUTHENTICATED);
}

/** A profile view (author, reposter, quoted author) as an item author. */
export function authorOf(profile: unknown): ItemAuthor | undefined {
  if (!isObject(profile)) return undefined;
  const did = normalizeDid(str(profile.did) ?? "");
  if (!did) return undefined;
  const handle = normalizeHandle(str(profile.handle) ?? "");
  const name = toPlainText(str(profile.displayName)).slice(0, 200) || handle;
  const iconUrl = httpsUrl(profile.avatar);
  return {
    ...(name ? { name } : {}),
    ...(handle ? { handle: formatHandle(handle) } : {}),
    url: profileUrl(did),
    ...(iconUrl ? { iconUrl } : {}),
  };
}

/** The DID a profile view names. */
export function didOf(profile: unknown): string | undefined {
  return isObject(profile) ? normalizeDid(str(profile.did) ?? "") : undefined;
}

/**
 * A record's createdAt, never after the AppView indexed it (createdAt is set by the posting client
 * and can be in the future); `now` only when neither is readable.
 */
function publishedOf(record: Json, indexedAt: unknown, now: Date): Date {
  const indexed = Date.parse(str(indexedAt) ?? "");
  const created = Date.parse(str(record.createdAt) ?? "");
  if (!Number.isNaN(created)) return new Date(Number.isNaN(indexed) ? created : Math.min(created, indexed));
  return Number.isNaN(indexed) ? now : new Date(indexed);
}

// --- Text and facets ------------------------------------------------------------------------------

interface Span {
  start: number;
  end: number;
  href: string;
}

/** The link a facet makes: a URL (https only), a mention's profile, a hashtag's page. */
function facetHref(features: unknown): string | undefined {
  for (const feature of list(features)) {
    if (!isObject(feature)) continue;
    const type = str(feature.$type);
    if (type === "app.bsky.richtext.facet#link") {
      const uri = httpsUrl(feature.uri);
      if (uri) return uri;
    } else if (type === "app.bsky.richtext.facet#mention") {
      const did = normalizeDid(str(feature.did) ?? "");
      if (did) return profileUrl(did);
    } else if (type === "app.bsky.richtext.facet#tag") {
      const tag = str(feature.tag);
      if (tag && tag.length <= 640) return `${BSKY_APP}/hashtag/${encodeURIComponent(tag)}`;
    }
  }
  return undefined;
}

/** Facets as non-overlapping byte spans, in order; malformed or overlapping ones are skipped. */
function spansOf(facets: unknown, byteLength: number): Span[] {
  const spans: Span[] = [];
  for (const facet of list(facets)) {
    if (!isObject(facet) || !isObject(facet.index)) continue;
    const start = facet.index.byteStart;
    const end = facet.index.byteEnd;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > byteLength) continue;
    const href = facetHref(facet.features);
    if (href) spans.push({ start, end, href });
  }
  spans.sort((a, b) => a.start - b.start);
  const kept: Span[] = [];
  for (const span of spans) {
    const last = kept[kept.length - 1];
    if (!last || span.start >= last.end) kept.push(span);
  }
  return kept;
}

/** Escaped text with its line breaks: blank lines end paragraphs, single breaks are <br>. */
function textHtml(text: string): string {
  return escapeHtml(text).replace(/\n\s*\n/g, "</p><p>").replace(/\n/g, "<br>");
}

/** A post's text and facets as sanitized HTML paragraphs. */
export function postHtml(text: string, facets: unknown): string {
  if (text.trim() === "") return "";
  const bytes = Buffer.from(text, "utf8");
  let html = "";
  let at = 0;
  for (const span of spansOf(facets, bytes.length)) {
    html += textHtml(bytes.subarray(at, span.start).toString("utf8"));
    const label = bytes.subarray(span.start, span.end).toString("utf8").replace(/\s+/g, " ");
    html += `<a href="${escapeHtml(span.href)}">${escapeHtml(label)}</a>`;
    at = span.end;
  }
  html += textHtml(bytes.subarray(at).toString("utf8"));
  return sanitize(`<p>${html}</p>`.replace(/<p>\s*<\/p>/g, ""));
}

// --- Embeds --------------------------------------------------------------------------------------

/** The images of an `embed.images#view` or `embed.gallery#view`. */
function imagesOf(view: Json, size: "fullsize" | "thumb"): MediaRef[] {
  const entries = str(view.$type) === "app.bsky.embed.gallery#view" ? list(view.items) : list(view.images);
  const media: MediaRef[] = [];
  for (const image of entries) {
    if (!isObject(image)) continue;
    const url = httpsUrl(size === "thumb" ? (image.thumb ?? image.thumbnail) : image.fullsize) ?? httpsUrl(image.thumb ?? image.thumbnail);
    if (!url) continue;
    const alt = toPlainText(str(image.alt)).slice(0, 2_000);
    const ratio = isObject(image.aspectRatio) ? image.aspectRatio : undefined;
    const width = typeof ratio?.width === "number" && ratio.width > 0 ? ratio.width : undefined;
    const height = typeof ratio?.height === "number" && ratio.height > 0 ? ratio.height : undefined;
    media.push({ type: "image", url, ...(alt ? { alt } : {}), ...(width && height ? { width, height } : {}) });
  }
  return media;
}

/** A video's thumbnail (no player: the playlist is HLS). */
function videoThumbnail(view: Json): MediaRef[] {
  const url = httpsUrl(view.thumbnail);
  if (!url) return [];
  const alt = toPlainText(str(view.alt)).slice(0, 2_000);
  const ratio = isObject(view.aspectRatio) ? view.aspectRatio : undefined;
  const width = typeof ratio?.width === "number" && ratio.width > 0 ? ratio.width : undefined;
  const height = typeof ratio?.height === "number" && ratio.height > 0 ? ratio.height : undefined;
  return [{ type: "image", url, ...(alt ? { alt } : {}), ...(width && height ? { width, height } : {}) }];
}

function linkCard(view: Json): ItemEmbed["link"] | undefined {
  const external = isObject(view.external) ? view.external : undefined;
  const url = httpsUrl(external?.uri);
  if (!external || !url) return undefined;
  const title = toPlainText(str(external.title)).slice(0, MAX_TITLE);
  const description = toPlainText(str(external.description)).slice(0, MAX_DESCRIPTION);
  const thumb = httpsUrl(external.thumb);
  return { url, ...(title ? { title } : {}), ...(description ? { description } : {}), ...(thumb ? { thumb } : {}) };
}

/** A quoted record (`embed.record#view`'s `record`). Posts only; others aren't shown. */
function quoteOf(record: unknown): QuotedPost | undefined {
  if (!isObject(record)) return undefined;
  const type = str(record.$type);
  if (
    type === "app.bsky.embed.record#viewNotFound" ||
    type === "app.bsky.embed.record#viewBlocked" ||
    type === "app.bsky.embed.record#viewDetached"
  ) {
    return { unavailable: true };
  }
  if (type !== "app.bsky.embed.record#viewRecord") return undefined;
  const value = isObject(record.value) ? record.value : undefined;
  if (str(value?.$type) !== "app.bsky.feed.post") return undefined;
  if (hidesFromVisitors(record.author) || labelsOf(record).some((l) => HIDDEN_LABELS.has(l))) {
    return { unavailable: true };
  }
  const url = postUrl(str(record.uri) ?? "");
  const author = authorOf(record.author);
  const text = (str(value?.text) ?? "").slice(0, MAX_QUOTE);
  const published = Date.parse(str(value?.createdAt) ?? str(record.indexedAt) ?? "");
  const media: MediaRef[] = [];
  for (const embed of list(record.embeds)) {
    if (!isObject(embed)) continue;
    const t = str(embed.$type);
    if (t === "app.bsky.embed.images#view" || t === "app.bsky.embed.gallery#view") media.push(...imagesOf(embed, "thumb"));
    else if (t === "app.bsky.embed.video#view") media.push(...videoThumbnail(embed));
    else if (t === "app.bsky.embed.recordWithMedia#view" && isObject(embed.media)) {
      const m = embed.media;
      const mt = str(m.$type);
      if (mt === "app.bsky.embed.images#view" || mt === "app.bsky.embed.gallery#view") media.push(...imagesOf(m, "thumb"));
      else if (mt === "app.bsky.embed.video#view") media.push(...videoThumbnail(m));
    }
  }
  return {
    ...(url ? { url } : {}),
    ...(author ? { author } : {}),
    ...(text.trim() ? { text } : {}),
    ...(Number.isNaN(published) ? {} : { publishedAt: new Date(published).toISOString() }),
    ...(media.length > 0 ? { media: media.slice(0, 4) } : {}),
  };
}

export interface EmbedParts {
  kind: ItemKind;
  media: MediaRef[];
  embed?: ItemEmbed;
}

/** What a post's embed view adds: its kind, media, and link card or quote. */
export function embedParts(embed: unknown): EmbedParts {
  if (!isObject(embed)) return { kind: "post", media: [] };
  const type = str(embed.$type);
  switch (type) {
    case "app.bsky.embed.images#view":
    case "app.bsky.embed.gallery#view": {
      const media = imagesOf(embed, "fullsize");
      return { kind: media.length > 0 ? "photo" : "post", media };
    }
    case "app.bsky.embed.video#view":
      return { kind: "video", media: videoThumbnail(embed) };
    case "app.bsky.embed.external#view": {
      const link = linkCard(embed);
      return { kind: "post", media: [], ...(link ? { embed: { link } } : {}) };
    }
    case "app.bsky.embed.record#view": {
      const quote = quoteOf(embed.record);
      return { kind: "post", media: [], ...(quote ? { embed: { quote } } : {}) };
    }
    case "app.bsky.embed.recordWithMedia#view": {
      const inner = isObject(embed.record) ? embed.record.record : undefined;
      const quote = quoteOf(inner);
      const parts = embedParts(embed.media);
      const merged: ItemEmbed = { ...(parts.embed ?? {}), ...(quote ? { quote } : {}) };
      return { kind: parts.kind, media: parts.media, ...(Object.keys(merged).length > 0 ? { embed: merged } : {}) };
    }
    default:
      return { kind: "post", media: [] };
  }
}

// --- Entries -------------------------------------------------------------------------------------

/**
 * What an atproto item keeps in `raw`: the entry as the AppView sent it, and the link card or
 * quote the card draws (readEmbed() reads it back).
 */
export interface BlueskyRaw {
  feedViewPost: unknown;
  embed?: ItemEmbed;
}

/** One getAuthorFeed entry as an item; undefined for anything that isn't a readable post. */
export function mapFeedEntry(entry: unknown, ctx: MapContext): NormalizedItem | undefined {
  if (!isObject(entry) || !isObject(entry.post)) return undefined;
  const post = entry.post;
  const record = isObject(post.record) ? post.record : undefined;
  const uri = str(post.uri);
  if (!record || !uri || str(record.$type) !== "app.bsky.feed.post") return undefined;
  const url = postUrl(uri);
  const original = authorOf(post.author);
  if (!url || !original) return undefined;

  const text = str(record.text) ?? "";
  const parts = embedParts(post.embed);
  const contentHtml = postHtml(text, record.facets);
  const adult = labelsOf(post).some((l) => HIDDEN_LABELS.has(l));
  const raw: BlueskyRaw = { feedViewPost: entry, ...(parts.embed ? { embed: parts.embed } : {}) };
  const base = {
    kind: parts.kind,
    ...(contentHtml ? { contentHtml } : {}),
    url,
    media: parts.media,
    isFinalResult: false,
    raw,
  };

  const reason = isObject(entry.reason) ? entry.reason : undefined;
  if (str(reason?.$type) === "app.bsky.feed.defs#reasonRepost" && reason) {
    const reposter = authorOf(reason.by);
    if (!reposter) return undefined;
    const repostDid = didOf(reason.by) as string;
    const sourceId = str(reason.uri) ?? `at://${repostDid}/app.bsky.feed.repost/?subject=${encodeURIComponent(uri)}`;
    const boostOf: BoostRef = { objectId: uri, host: "bsky.app", url, author: original, fetched: true };
    return {
      ...base,
      sourceId,
      publishedAt: publishedOf({}, reason.indexedAt, ctx.now),
      author: reposter,
      boostOf,
      // A repost of a reply is shown (as fetched fediverse boosts are); the reposted author's wish
      // not to be shown to signed-out readers is kept.
      hidden: adult || hidesFromVisitors(post.author),
    };
  }
  // Pinned posts and other reasons aren't asked for (getAuthorFeed without includePins).
  if (reason) return undefined;

  return {
    ...base,
    sourceId: uri,
    publishedAt: publishedOf(record, post.indexedAt, ctx.now),
    author: original,
    hidden: adult || isObject(record.reply),
  };
}

/**
 * Reads a stored item's link card or quote back from `raw` for the feed, keeping only well-formed
 * plain values and https URLs (the column is jsonb another version of the code may have written).
 */
export function readEmbed(raw: unknown): ItemEmbed | undefined {
  const embed = isObject(raw) ? raw : undefined;
  if (!embed) return undefined;
  const out: ItemEmbed = {};
  if (isObject(embed.link)) {
    const url = httpsUrl(embed.link.url);
    if (url) {
      const title = str(embed.link.title)?.slice(0, MAX_TITLE);
      const description = str(embed.link.description)?.slice(0, MAX_DESCRIPTION);
      const thumb = httpsUrl(embed.link.thumb);
      out.link = { url, ...(title ? { title } : {}), ...(description ? { description } : {}), ...(thumb ? { thumb } : {}) };
    }
  }
  if (isObject(embed.quote)) {
    const q = embed.quote;
    if (q.unavailable === true) {
      out.quote = { unavailable: true };
    } else {
      const url = httpsUrl(q.url);
      const a = isObject(q.author) ? q.author : undefined;
      const author: ItemAuthor | undefined = a
        ? {
            ...(str(a.name) ? { name: str(a.name) } : {}),
            ...(str(a.handle) ? { handle: str(a.handle) } : {}),
            ...(httpsUrl(a.url) ? { url: httpsUrl(a.url) } : {}),
            ...(httpsUrl(a.iconUrl) ? { iconUrl: httpsUrl(a.iconUrl) } : {}),
          }
        : undefined;
      const media = list(q.media)
        .filter(isObject)
        .map((m) => ({ url: httpsUrl(m.url), alt: str(m.alt) }))
        .filter((m): m is { url: string; alt: string | undefined } => m.url !== undefined)
        .slice(0, 4)
        .map((m): MediaRef => ({ type: "image", url: m.url, ...(m.alt ? { alt: m.alt } : {}) }));
      const published = str(q.publishedAt);
      out.quote = {
        ...(url ? { url } : {}),
        ...(author ? { author } : {}),
        ...(str(q.text) ? { text: (q.text as string).slice(0, MAX_QUOTE) } : {}),
        ...(published && !Number.isNaN(Date.parse(published)) ? { publishedAt: published } : {}),
        ...(media.length > 0 ? { media } : {}),
      };
    }
  }
  return out.link || out.quote ? out : undefined;
}
