// The River UI's one API call: GET /api/feed (spec 4.5; shape in DECISIONS.md "The feed API's
// shape (M5)"). Same origin only (CSP connect-src 'self'). Visitors make no other request and
// no server write (check 23): read state lives in the browser (readState.ts).

export type ItemKind = "post" | "article" | "podcast" | "video" | "photo" | "event" | "civic";

export interface MediaRef {
  type: "image" | "video" | "audio";
  url: string;
  alt?: string;
  /** Seconds. */
  duration?: number;
  width?: number;
  height?: number;
}

export interface ItemAuthor {
  name?: string;
  handle?: string;
  url?: string;
  iconUrl?: string;
}

export interface BoostRef {
  objectId: string;
  host: string;
  url?: string;
  author?: ItemAuthor;
}

export interface CivicDetails {
  activityType?: string;
  objectType?: string;
  processType?: string;
  deadline?: string;
  label?: string;
  terminalState?: string;
}

export interface FeedItem {
  id: string;
  kind: ItemKind;
  publishedAt: string;
  title: string | null;
  summary: string | null;
  /** Sanitized on the server (src/shared/sanitize/); the only HTML the UI renders. */
  contentHtml: string | null;
  /** Null for samples. */
  url: string | null;
  streamKey: string | null;
  author: ItemAuthor | null;
  media: MediaRef[];
  boostOf: BoostRef | null;
  civic: CivicDetails | null;
  isFinalResult: boolean;
  event?: { startTime?: string; location?: string };
  source: "live" | "sample";
  space: {
    id: string;
    name: string;
    iconUrl: string | null;
    category: string | null;
    adapter: string;
  };
}

export interface FeedCircle {
  id: string;
  name: string;
  color: string | null;
  role: "civic" | null;
}

export interface FeedResponse {
  instance: { name: string; theme: string; modes: string[]; defaultMode: string };
  mode: string;
  circles: FeedCircle[];
  items: FeedItem[];
  nextCursor: string | null;
  empty: boolean;
  emptyMessage: string | null;
  refresh: { claimed: string[]; pending: string[] };
}

export interface FeedQuery {
  circle?: string;
  type?: string;
  q?: string;
  cursor?: string;
}

export type FeedResult =
  | { status: "ok"; feed: FeedResponse }
  /** The API knows no River at this hostname (check 26): the UI shows its 404 page. */
  | { status: "unknown_host"; message: string }
  | { status: "error"; message: string };

/** The query string for /api/feed; empty values and "All" are left out. */
export function feedSearch(query: FeedQuery): string {
  const params = new URLSearchParams();
  if (query.circle && query.circle !== "All") params.set("circle", query.circle);
  if (query.type && query.type !== "all") params.set("type", query.type);
  const q = query.q?.trim();
  if (q) params.set("q", q);
  if (query.cursor) params.set("cursor", query.cursor);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export async function loadFeed(query: FeedQuery, signal?: AbortSignal): Promise<FeedResult> {
  let res: Response;
  try {
    res = await fetch(`/api/feed${feedSearch(query)}`, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { status: "error", message: "We couldn't reach the River. Check your connection and try again." };
  }
  const body: unknown = await res.json().catch(() => undefined);
  const error = (body as { error?: unknown; message?: unknown } | undefined) ?? {};
  if (res.status === 404 && error.error === "unknown_host") {
    return {
      status: "unknown_host",
      message: typeof error.message === "string" ? error.message : "There is no River at this address.",
    };
  }
  if (!res.ok || !body) {
    return { status: "error", message: "The River couldn't load right now. Try again in a moment." };
  }
  return { status: "ok", feed: body as FeedResponse };
}
