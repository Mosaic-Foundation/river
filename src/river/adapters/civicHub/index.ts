// The Civic Hub adapter (spec 4.2, ADR-003): resolves a hub from any URL on its host, reads its
// activity feed in pages through the fetch guard it is given (ctx.guard, ADR-001), and turns
// activities into items. It stores nothing itself; the refresh (M5) writes what it returns.
import {
  AdapterError,
  ADAPTER_MESSAGES,
  type Adapter,
  type FetchContext,
  type FetchResult,
  type NormalizedItem,
  type SpacePreview,
  type SpaceRecord,
  type StreamUpdate,
} from "../../../shared/items/index.js";
import { toPlainText } from "../../../shared/sanitize/index.js";
import {
  adapterErrorFrom,
  firstFetchUrl,
  getActivityPage,
  PAGING,
  refreshUrl,
  streamProbeUrl,
} from "./feed.js";
import { httpsUrl, mapActivity, type MappedActivity } from "./map.js";
import { streamKeyFromUrl } from "./streams.js";

export { ALLOWLIST, KNOWN_HIDDEN, allowRow, type AllowRow } from "./allowlist.js";
export { HUB_TEMPLATES, templateText } from "./hubTemplates.js";
export { firstFetchUrl, refreshUrl, streamProbeUrl, PAGING } from "./feed.js";
export { mapActivity, isPublic, AS_PUBLIC } from "./map.js";
export { streamKey, streamKeyFromUrl, processIdFromPath } from "./streams.js";

/** Where a hub describes itself. */
export function civicJsonUrl(url: URL): string {
  return `${url.protocol}//${url.host}/.well-known/civic.json`;
}

/**
 * What was typed, as a URL: a full URL, or a bare host with an optional path
 * ("floyd.civic.social/process/proc_1"). Undefined for handles and anything else.
 */
export function parseHubInput(input: string): URL | undefined {
  const text = input.trim();
  if (!text || /\s/.test(text) || text.startsWith("@")) return undefined;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  // name@server without a scheme is a fediverse handle, not a host.
  if (!hasScheme && text.split("/")[0].includes("@")) return undefined;
  const withScheme = hasScheme ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (!url.hostname.includes(".") && !url.hostname.startsWith("[") && url.hostname !== "localhost") return undefined;
    return url;
  } catch {
    return undefined;
  }
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

/** GET /.well-known/civic.json and read the fields a preview needs (spec 4.2 Resolve). */
async function readCivicJson(url: URL, ctx: Pick<FetchContext, "guard">): Promise<Omit<SpacePreview, "stream">> {
  let res: Response;
  try {
    res = await ctx.guard.fetch(civicJsonUrl(url), { headers: { accept: "application/json" } });
  } catch (err) {
    throw adapterErrorFrom(err);
  }
  if (res.status >= 500) {
    await res.body?.cancel();
    throw new AdapterError("unreachable", `${ADAPTER_MESSAGES.unreachable} (HTTP ${res.status})`);
  }
  let body: Json | undefined;
  try {
    body = record(await res.json());
  } catch {
    body = undefined;
  }
  // {"code":"no_hub"}, a 404 page, or anything that isn't a hub description.
  const notASpace = new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  if (!res.ok || !body || body.code === "no_hub") throw notASpace;
  const space = record(body.space);
  const spaceId = typeof space?.id === "string" ? space.id : undefined;
  const name = typeof body.name === "string" ? toPlainText(body.name).slice(0, 200) : "";
  const feeds = Array.isArray(body.feeds) ? body.feeds : [];
  const feedUrl = httpsUrl(feeds[0]);
  if (!spaceId || !name || !feedUrl) throw notASpace;

  const spaceType = typeof space?.type === "string" ? space.type : undefined;
  const jurisdictions = Array.isArray(body.jurisdictions)
    ? body.jurisdictions.filter((j): j is string => typeof j === "string").slice(0, 20)
    : undefined;
  // `icon` isn't in civic.json yet (spec: "optional future icon"); a string or {url}, https only.
  const iconUrl = httpsUrl(body.icon) ?? httpsUrl(record(body.icon)?.url);
  const origin = `https://${url.host.toLowerCase()}`;
  return {
    adapter: "civic_hub",
    canonicalUrl: origin,
    name,
    ...(iconUrl ? { iconUrl } : {}),
    homeUrl: origin,
    feedUrl,
    ...(spaceType === "civic.hub" ? { category: "civic" as const } : {}),
    manifest: {
      spaceId,
      ...(spaceType ? { spaceType } : {}),
      ...(jurisdictions && jurisdictions.length ? { jurisdictions } : {}),
    },
  };
}

export interface StreamProbe {
  /** The hub serves this stream. */
  exists: boolean;
  /** The newest public activity in it, when the first page held one. */
  newest?: MappedActivity;
}

/**
 * Asks the hub whether it serves a stream (spec 4.2: stream validation, and the withdrawn-process
 * probe M5 runs during refresh, check 33). Hub pages are filtered after the limit, so a live stream
 * whose newest event isn't public answers an empty page that still carries `next` (recorded from
 * Longmont); only an empty page with no `next` means the hub serves nothing for that context.
 */
export async function probeStream(
  feedUrl: string,
  key: string,
  ctx: Pick<FetchContext, "guard">,
): Promise<StreamProbe> {
  const page = await getActivityPage(ctx, streamProbeUrl(feedUrl, key));
  for (const raw of page.items) {
    const mapped = mapActivity(raw);
    if (mapped && mapped.item.streamKey === key) return { exists: true, newest: mapped };
  }
  return { exists: page.items.length > 0 || Boolean(page.next) };
}

async function resolve(input: string, ctx: Pick<FetchContext, "guard" | "now">): Promise<SpacePreview> {
  const url = parseHubInput(input);
  if (!url) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  const preview = await readCivicJson(url, ctx);
  const key = streamKeyFromUrl(url);
  if (!key) return preview;
  const probe = await probeStream(preview.feedUrl as string, key, ctx);
  if (!probe.exists) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  const title = probe.newest?.streamTitle ?? probe.newest?.item.title;
  return { ...preview, stream: { key, ...(title ? { title } : {}) } };
}

/** Per-stream facts gathered across a fetch's pages (spec 4.2 stream end). */
interface StreamFacts {
  title?: string;
  end?: NormalizedItem;
  /** The latest Announce civic:Result or Create civic:Outcome. */
  candidate?: NormalizedItem;
}

function later(a: NormalizedItem | undefined, b: NormalizedItem): NormalizedItem {
  return !a || b.publishedAt.getTime() > a.publishedAt.getTime() ? b : a;
}

function finalOf(facts: StreamFacts): NormalizedItem | undefined {
  return facts.candidate ?? facts.end;
}

async function fetchNew(space: SpaceRecord, ctx: FetchContext): Promise<FetchResult> {
  const feedUrl = space.feedUrl ? httpsUrl(space.feedUrl) : undefined;
  if (!feedUrl) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  const refreshing = Boolean(space.newestItemAt);
  const firstUrl = space.newestItemAt ? refreshUrl(feedUrl, space.newestItemAt) : firstFetchUrl(feedUrl, ctx.now);
  const maxPages = refreshing ? PAGING.refreshPages : PAGING.firstFetchPages;
  const feedOrigin = new URL(feedUrl).origin;

  const seen = new Set<string>();
  const items: NormalizedItem[] = [];
  const streams = new Map<string, StreamFacts>();
  const titles = new Map<string, string>();
  const visited = new Set<string>();
  let etag: string | undefined;
  let newest = space.newestItemAt ?? null;
  let lastError: string | null = null;

  let url: string | undefined = firstUrl;
  for (let pageNo = 0; url && pageNo < maxPages; pageNo++) {
    visited.add(url);
    // If-None-Match only on the exact URL the stored ETag came from (spec 4.2 Refresh).
    const headers = pageNo === 0 && space.etag && space.etagUrl === url ? { "if-none-match": space.etag } : undefined;
    let page;
    try {
      page = await getActivityPage(ctx, url, headers);
    } catch (err) {
      // Nothing gained yet: the caller records the error. Later pages: keep what arrived.
      if (pageNo === 0) throw err;
      lastError = err instanceof Error ? err.message : String(err);
      break;
    }
    if (page.status === 304) {
      return { items: [], space: { fetchStatus: "ok", lastError: null }, streams: [], notModified: true };
    }
    if (pageNo === 0) etag = page.etag;

    const mapped: MappedActivity[] = [];
    for (const raw of page.items) {
      const m = mapActivity(raw);
      if (!m || seen.has(m.item.sourceId)) continue;
      seen.add(m.item.sourceId);
      mapped.push(m);
      if (m.streamTitle && m.item.streamKey && !titles.has(m.item.streamKey)) titles.set(m.item.streamKey, m.streamTitle);
    }
    const pageItems: NormalizedItem[] = [];
    for (const m of mapped) {
      // Title from this page's and earlier pages' Create civic:Process when the object has no name.
      const item = !m.item.title && m.item.streamKey && titles.has(m.item.streamKey)
        ? { ...m.item, title: titles.get(m.item.streamKey) }
        : m.item;
      if (item.streamKey) {
        const facts = streams.get(item.streamKey) ?? {};
        if (m.streamTitle) facts.title ??= m.streamTitle;
        if (m.endsStream) facts.end = later(facts.end, item);
        if (m.finalCandidate) facts.candidate = later(facts.candidate, item);
        streams.set(item.streamKey, facts);
      }
      if (!newest || item.publishedAt > newest) newest = item.publishedAt;
      pageItems.push(item);
    }
    // Final-result flags as far as this fetch knows; StreamUpdate.finalItemSourceId is the last word.
    const flagged = pageItems.map((item) => {
      const facts = item.streamKey ? streams.get(item.streamKey) : undefined;
      return { ...item, isFinalResult: Boolean(facts && finalOf(facts)?.sourceId === item.sourceId) };
    });
    items.push(...flagged);
    if (ctx.onPage && flagged.length) await ctx.onPage(flagged);

    // Follow `next` even when the page held fewer than `limit` items (hub pages are filtered after
    // the limit), but only on the feed's own origin and never back to a page already read.
    const next: string | undefined = page.next;
    url = next && new URL(next).origin === feedOrigin && !visited.has(next) ? next : undefined;
  }

  const finals = new Map<string, string>();
  const updates: StreamUpdate[] = [];
  for (const [key, facts] of streams) {
    const final = finalOf(facts);
    if (final) finals.set(key, final.sourceId);
    if (!facts.title && !facts.end && !final) continue;
    updates.push({
      key,
      ...(facts.title ? { title: facts.title } : {}),
      ...(facts.end ? { status: "ended" as const, endedAt: ctx.now } : {}),
      ...(final ? { finalItemSourceId: final.sourceId } : {}),
    });
  }
  const finalItems = items.map((item) => ({
    ...item,
    isFinalResult: Boolean(item.streamKey && finals.get(item.streamKey) === item.sourceId),
  }));

  return {
    items: finalItems,
    space: {
      etag: etag ?? null,
      etagUrl: etag ? firstUrl : null,
      newestItemAt: newest,
      fetchStatus: lastError ? "error" : "ok",
      lastError,
    },
    streams: updates,
    notModified: false,
  };
}

export const civicHubAdapter: Adapter = {
  name: "civic_hub",
  accepts(input) {
    const url = parseHubInput(input);
    // A fediverse profile URL (https://server/@name) is the fediverse adapter's.
    return Boolean(url) && !url!.pathname.startsWith("/@");
  },
  resolve,
  fetchNew,
};
