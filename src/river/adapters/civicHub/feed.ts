// Hub feed requests (spec 4.2): the URLs, and one guarded GET of an activity page. Kept apart from
// the adapter so the fixture recorder (scripts/recorders/civicHub.ts) builds exactly the URLs the
// adapter will ask for when the recordings are replayed.
import { AdapterError, ADAPTER_MESSAGES, type FetchContext } from "../../../shared/items/index.js";
import { FetchError, followMessage } from "../../../shared/fetch/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const PAGING = {
  /** Items asked for per page. */
  limit: 50,
  /** First fetch: how far back, and how many pages at most. */
  firstFetchDays: 90,
  firstFetchPages: 5,
  /** Refresh: since = newest item minus this, and how many pages at most. */
  refreshOverlapDays: 14,
  refreshPages: 3,
} as const;

/** The first page of a space's first fetch: `{feed}?page=true&limit=50&since={now - 90 days}`. */
export function firstFetchUrl(feedUrl: string, now: Date): string {
  return pageUrl(feedUrl, new Date(now.getTime() - PAGING.firstFetchDays * DAY_MS));
}

/** The first page of a refresh: since = newest_item_at minus 14 days (hub `since` is created_at). */
export function refreshUrl(feedUrl: string, newestItemAt: Date): string {
  return pageUrl(feedUrl, new Date(newestItemAt.getTime() - PAGING.refreshOverlapDays * DAY_MS));
}

function pageUrl(feedUrl: string, since: Date): string {
  const url = new URL(feedUrl);
  url.searchParams.set("page", "true");
  url.searchParams.set("limit", String(PAGING.limit));
  url.searchParams.set("since", since.toISOString());
  return url.href;
}

/** Stream validation and the withdrawn-process probe: `{feed}?page=true&context={key}&limit=1`. */
export function streamProbeUrl(feedUrl: string, key: string): string {
  const url = new URL(feedUrl);
  url.searchParams.set("page", "true");
  url.searchParams.set("context", key);
  url.searchParams.set("limit", "1");
  return url.href;
}

/** A FetchError (or anything else thrown on the way) in the follow box's terms. */
export function adapterErrorFrom(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const reason = followMessage(err) === ADAPTER_MESSAGES.refused ? "refused" : "unreachable";
  const detail = err instanceof FetchError ? ` (${err.code})` : "";
  return new AdapterError(reason, `${ADAPTER_MESSAGES[reason]}${detail}`);
}

export interface ActivityPage {
  status: number;
  etag?: string;
  /** orderedItems (or items), as received. */
  items: unknown[];
  /** The `next` page's URL, when it is an https URL. */
  next?: string;
}

/** GETs one page. A 304 comes back with no items; any other non-2xx is an AdapterError. */
export async function getActivityPage(
  ctx: Pick<FetchContext, "guard">,
  url: string,
  headers: Record<string, string> = {},
): Promise<ActivityPage> {
  let res: Response;
  try {
    res = await ctx.guard.fetch(url, {
      headers: { accept: "application/activity+json, application/json;q=0.9", ...headers },
    });
  } catch (err) {
    throw adapterErrorFrom(err);
  }
  if (res.status === 304) {
    await res.body?.cancel();
    return { status: 304, items: [] };
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new AdapterError("unreachable", `${ADAPTER_MESSAGES.unreachable} (HTTP ${res.status})`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AdapterError("unreachable", `${ADAPTER_MESSAGES.unreachable} (not JSON)`);
  }
  const page = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const items = Array.isArray(page.orderedItems) ? page.orderedItems : Array.isArray(page.items) ? page.items : [];
  const nextRaw = page.next;
  const next =
    typeof nextRaw === "string"
      ? nextRaw
      : nextRaw && typeof nextRaw === "object" && typeof (nextRaw as { id?: unknown }).id === "string"
        ? (nextRaw as { id: string }).id
        : undefined;
  const etag = res.headers.get("etag") ?? undefined;
  return { status: res.status, items, ...(etag ? { etag } : {}), ...(next && isHttps(next) ? { next } : {}) };
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
