// The feed adapter (M12, ADR-007): RSS 2.0, RSS 1.0 and Atom feeds, and podcast feeds (Apple's
// namespace, enclosures). The follow box takes a feed URL, or a web page that names its feed with
// <link rel="alternate" type="application/rss+xml|atom+xml">. Everything is read through the fetch
// guard the caller passes (ADR-001: a feed a member asked to follow is a source they asked for).
//
// Resolve: GET the URL. A feed document is the space; an HTML page is searched for feed links and
// the first that reads as a feed is the space. canonical_url and feed_url are the feed's own URL
// (after redirects), home_url the site it names.
//
// Fetch: GET the feed (If-None-Match when the stored ETag is for that exact URL; a 304 keeps what is
// stored), map every entry, keep the newest MAX_ITEMS from the last ITEM_WINDOW_DAYS (older ones
// would be removed by the daily retention anyway), and store them in one page. newest_item_at
// counts every entry, so a quiet feed shows as Quiet (spec F7).
import type { FetchGuard } from "../../../shared/fetch/index.js";
import {
  AdapterError,
  ADAPTER_MESSAGES,
  type Adapter,
  type FetchContext,
  type FetchResult,
  type NormalizedItem,
  type SpaceCategory,
  type SpacePreview,
  type SpaceRecord,
} from "../../../shared/items/index.js";
import { toPlainText } from "../../../shared/sanitize/index.js";
import { adapterErrorFrom, RATE_LIMITED_MESSAGE } from "../fediverse/http.js";
import { discoverFeeds, looksLikeHtml } from "./discover.js";
import { parseFeed, type ParsedFeed } from "./feed.js";
import { httpsLink, mapEntry, parseDate } from "./map.js";

/** What the adapter asks for: feeds first, then pages that may name one. */
export const FEED_ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5, */*;q=0.1";

/** Items kept per fetch, newest first. */
export const MAX_ITEMS = 50;
/** Entries older than this are not stored (spec 3.1 retention removes them after 90 days). */
export const ITEM_WINDOW_DAYS = 90;

export interface FeedManifest {
  format: ParsedFeed["format"];
  /** True when the feed has audio enclosures. */
  podcast: boolean;
  /** The page the feed was found on, when the follow box was given a page. */
  discoveredFrom?: string;
}

interface TextResponse {
  status: number;
  /** The final URL after redirects. */
  url: string;
  contentType: string | null;
  etag: string | null;
  /** The body, for a 2xx. */
  text?: string;
}

async function getText(guard: FetchGuard, url: string, headers: Record<string, string>): Promise<TextResponse> {
  let res: Response;
  try {
    res = await guard.fetch(url, { headers });
  } catch (err) {
    throw adapterErrorFrom(err);
  }
  const base = {
    status: res.status,
    url: res.url || url,
    contentType: res.headers.get("content-type"),
    etag: res.headers.get("etag"),
  };
  if (res.status < 200 || res.status >= 300) {
    await res.body?.cancel();
    return base;
  }
  try {
    return { ...base, text: await res.text() };
  } catch (err) {
    throw adapterErrorFrom(err);
  }
}

function statusError(status: number, notFound: AdapterError["reason"]): AdapterError {
  if (status === 429) return new AdapterError("unreachable", RATE_LIMITED_MESSAGE);
  if (status === 404 || status === 410) return new AdapterError(notFound, ADAPTER_MESSAGES[notFound]);
  return new AdapterError("unreachable", ADAPTER_MESSAGES.unreachable);
}

/** The feed in a 200 response, or undefined (an HTML page, or not a feed at all). */
function feedIn(res: TextResponse): ParsedFeed | undefined {
  if (res.status !== 200 || res.text === undefined || looksLikeHtml(res.contentType, res.text)) return undefined;
  return parseFeed(res.text);
}

/** The https URL typed in the follow box, or undefined. */
function inputUrl(input: string): URL | undefined {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    url.hash = "";
    return url;
  } catch {
    return undefined;
  }
}

function categoryOf(items: readonly NormalizedItem[]): SpaceCategory {
  if (items.some((i) => i.kind === "podcast")) return "podcast";
  if (items.some((i) => i.kind === "video")) return "video";
  return "publication";
}

function previewOf(feed: ParsedFeed, feedUrl: string, now: Date, discoveredFrom?: string): SpacePreview {
  const items = feed.entries.map((entry) => mapEntry(entry, feed, { feedUrl, now }));
  const category = categoryOf(items);
  const manifest: FeedManifest = {
    format: feed.format,
    podcast: category === "podcast",
    ...(discoveredFrom ? { discoveredFrom } : {}),
  };
  const title = toPlainText(feed.title).slice(0, 200);
  return {
    adapter: "rss",
    canonicalUrl: feedUrl,
    name: title || new URL(feedUrl).host,
    iconUrl: httpsLink(feed.image, feedUrl),
    homeUrl: httpsLink(feed.link, feedUrl) ?? discoveredFrom ?? feedUrl,
    feedUrl,
    network: feed.format,
    category,
    manifest: { ...manifest },
  };
}

export async function resolve(input: string, ctx: Pick<FetchContext, "guard" | "now">): Promise<SpacePreview> {
  const url = inputUrl(input);
  if (!url) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  const first = await getText(ctx.guard, url.toString(), { accept: FEED_ACCEPT });
  if (first.status !== 200) throw statusError(first.status, "not_a_space");
  const direct = feedIn(first);
  if (direct) return previewOf(direct, first.url, ctx.now);

  if (first.text !== undefined && looksLikeHtml(first.contentType, first.text)) {
    for (const candidate of discoverFeeds(first.text, first.url)) {
      let res: TextResponse;
      try {
        res = await getText(ctx.guard, candidate, { accept: FEED_ACCEPT });
      } catch {
        continue; // A feed link the guard refuses or can't reach: try the next one.
      }
      const feed = feedIn(res);
      if (feed) return previewOf(feed, res.url, ctx.now, first.url);
    }
  }
  throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
}

function newestOf(items: readonly NormalizedItem[], previous: Date | null | undefined): Date | undefined {
  let best = previous ?? undefined;
  for (const item of items) if (!best || item.publishedAt > best) best = item.publishedAt;
  return best;
}

export async function fetchNew(space: SpaceRecord, ctx: FetchContext): Promise<FetchResult> {
  const url = space.feedUrl ?? space.canonicalUrl;
  const headers: Record<string, string> = { accept: FEED_ACCEPT };
  if (space.etag && space.etagUrl === url) headers["if-none-match"] = space.etag;
  const res = await getText(ctx.guard, url, headers);
  if (res.status === 304) {
    return { items: [], space: { fetchStatus: "ok", lastError: null }, streams: [], notModified: true };
  }
  if (res.status !== 200) throw statusError(res.status, "unreachable");
  const feed = feedIn(res);
  if (!feed) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);

  const seen = new Set<string>();
  const all: NormalizedItem[] = [];
  for (const entry of feed.entries) {
    const item = mapEntry(entry, feed, { feedUrl: url, now: ctx.now });
    if (seen.has(item.sourceId)) continue;
    seen.add(item.sourceId);
    // An undated entry would take "now" again on every refresh and jump to the top; once it is
    // stored it keeps its first time.
    if (!parseDate(entry.date) && ctx.isKnown && (await ctx.isKnown(item.sourceId))) continue;
    all.push(item);
  }
  const since = ctx.now.getTime() - ITEM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const items = all
    .filter((item) => item.publishedAt.getTime() >= since)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, MAX_ITEMS);
  await ctx.onPage?.(items);
  const newestItemAt = newestOf(all, space.newestItemAt);
  return {
    items,
    space: {
      etag: res.etag,
      etagUrl: res.etag ? url : null,
      ...(newestItemAt ? { newestItemAt } : {}),
      fetchStatus: "ok",
      lastError: null,
    },
    streams: [],
    notModified: false,
  };
}

export const rssAdapter: Adapter = {
  name: "rss",
  accepts: (input) => inputUrl(input) !== undefined,
  resolve,
  fetchNew,
};

export { discoverFeeds, looksLikeHtml } from "./discover.js";
export { looksLikeFeed, MAX_ENTRIES, parseFeed, type FeedEntry, type ParsedFeed } from "./feed.js";
export { authorName, mapEntry, parseDate, parseDuration } from "./map.js";
export { parseXml, XmlError } from "./xml.js";
