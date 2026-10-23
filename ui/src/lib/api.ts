// The River UI's API calls (spec 4.5, 4.6; shapes in DECISIONS.md "The feed API's shape (M5)" and
// "Sign-in and member read state (M8)"). Same origin only (CSP connect-src 'self'). Visitors make
// only GET /api/feed and no server write (check 23): their read state lives in the browser
// (readState.ts). Members' read state is written here; their session is an HttpOnly cookie the
// page never sees.

/** Where Sign up and Sign in go: the River starts the identity host's sign-in (spec 4.6 step 1). */
export const SIGN_IN_URL = "/api/auth/signin";

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
  /** True when the refresh read the post from its own host (spec 4.3). */
  fetched?: boolean;
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
  /** Members only: the server's read state for this item. */
  read?: boolean;
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

/** A dated entry from the Coming up plugin (src/river/plugins/api.ts DateEntry). */
export interface DateEntry {
  date: string;
  what: "deadline" | "event";
  title: string;
  spaceName: string;
  itemId: string;
  url: string | null;
  source: "live" | "sample";
}

/** What a plugin returned; the UI draws each type with its own component. */
export type PluginOutput =
  | { type: "dates"; intro: string; entries: DateEntry[] }
  | { type: "placeholder"; text: string; waitingOn: string[] };

export interface SurfaceOutput {
  id: string;
  title: string;
  version: string;
  output: PluginOutput;
}

export type Surface = "river.panel" | "river.mode-header" | "river.card-action";

export interface ModeOption {
  id: string;
  title: string;
}

export interface FeedResponse {
  instance: { name: string; theme: string; modes: string[]; defaultMode: string };
  mode: string;
  /** The instance's modes, for the switch (hidden when there is one). */
  modes: ModeOption[];
  /** The current mode's theme. */
  theme: "mosaic" | "civic";
  /** Plugin outputs per surface, on the first page; null on later pages. */
  surfaces: Partial<Record<Surface, SurfaceOutput[]>> | null;
  circles: FeedCircle[];
  items: FeedItem[];
  nextCursor: string | null;
  empty: boolean;
  emptyMessage: string | null;
  refresh: { claimed: string[]; pending: string[] };
  /** The signed-in member, or null for a visitor. */
  viewer: Viewer | null;
}

export interface Viewer {
  did: string | null;
  displayName: string | null;
}

/** What the You tab and the header call a member: their name, else their DID. */
export function viewerLabel(viewer: Viewer): string {
  return viewer.displayName?.trim() || viewer.did || "Signed in";
}

export interface FeedQuery {
  /** Empty or undefined: the instance's default mode. */
  mode?: string;
  /** Circle ids, any of them; empty or undefined for All. */
  circles?: string[];
  /** Content types; empty or undefined for All. */
  types?: string[];
  /** Networks; empty or undefined for every network. */
  networks?: string[];
  q?: string;
  cursor?: string;
}

export type FeedResult =
  | { status: "ok"; feed: FeedResponse }
  /** The API knows no River at this hostname (check 26): the UI shows its 404 page. */
  | { status: "unknown_host"; message: string }
  /** The circle isn't one of the reader's (e.g. a visitor's circle name after signing in). */
  | { status: "bad_circle" }
  /** The mode isn't enabled on this instance (e.g. an old link): the UI opens the default. */
  | { status: "bad_mode" }
  | { status: "error"; message: string };

/** The query string for /api/feed; empty values are left out. */
export function feedSearch(query: FeedQuery): string {
  const params = new URLSearchParams();
  if (query.mode) params.set("mode", query.mode);
  // One `circle` per circle: a visitor's circles are named by name, which may hold a comma.
  for (const circle of query.circles ?? []) params.append("circle", circle);
  if (query.types?.length) params.set("type", query.types.join(","));
  if (query.networks?.length) params.set("network", query.networks.join(","));
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
  if (res.status === 400 && error.error === "bad_circle") return { status: "bad_circle" };
  if (res.status === 400 && error.error === "bad_mode") return { status: "bad_mode" };
  if (!res.ok || !body) {
    return { status: "error", message: "The River couldn't load right now. Try again in a moment." };
  }
  return { status: "ok", feed: body as FeedResponse };
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    // An item opened in a new tab still gets marked read if this page goes away.
    keepalive: true,
  });
}

/** A member's Mark read / Mark unread (and opening a link). Resolves false when it didn't save. */
export async function saveReadState(change: { read?: string[]; unread?: string[] }): Promise<boolean> {
  try {
    return (await post("/api/read-state", change)).ok;
  } catch {
    return false;
  }
}

/** Ends the River session (spec F10). */
export async function signOut(): Promise<boolean> {
  try {
    return (await post("/api/auth/signout")).ok;
  } catch {
    return false;
  }
}

export type ItemResult = { status: "ok"; item: FeedItem } | { status: "not_found" } | { status: "error" };

/** The framing check's answer for an opened item: the URL to frame, or null for the reader. */
export type FrameResult = { status: "ok"; url: string | null } | { status: "error" };

/** Whether an item's page can be framed (GET /api/items/{id}/frame, ui-revisions-2 item 2). */
export async function loadFrame(id: string, signal?: AbortSignal): Promise<FrameResult> {
  let res: Response;
  try {
    res = await fetch(`/api/items/${encodeURIComponent(id)}/frame`, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { status: "error" };
  }
  const body = (await res.json().catch(() => undefined)) as { frame?: { url?: unknown } | null } | undefined;
  if (!res.ok || !body || body.frame === undefined) return { status: "error" };
  const url = body.frame && typeof body.frame.url === "string" ? body.frame.url : null;
  return { status: "ok", url };
}

/** One stored item for the reader view (ui-revisions-1 item 1); the API fetches nothing new. */
export async function loadItem(id: string, signal?: AbortSignal): Promise<ItemResult> {
  let res: Response;
  try {
    res = await fetch(`/api/items/${encodeURIComponent(id)}`, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { status: "error" };
  }
  if (res.status === 404 || res.status === 400) return { status: "not_found" };
  const body = (await res.json().catch(() => undefined)) as { item?: FeedItem } | undefined;
  return res.ok && body?.item ? { status: "ok", item: body.item } : { status: "error" };
}
