// The framing check (ui-revisions-2 item 2, ADR-008): before the UI frames an opened item's page,
// the River asks that page once, through the fetch guard, and reads its headers. One GET of the
// item's own URL (redirects followed and re-checked by the guard), no cookies, the body dropped;
// answers are kept for a while so reopening an item asks nothing.
import { FetchError, getFetchGuard, type FetchGuard } from "../../shared/fetch/index.js";
import { framingAllowed } from "./policy.js";

export type FrameAnswer =
  | { frame: true; url: string }
  | { frame: false; reason: "refused" | "not_page" | "unreachable" };

export interface FrameCheckDeps {
  guard?: FetchGuard;
  now?: () => number;
}

/** A frame check waits at most this long; the UI shows "Opening…" meanwhile. */
export const FRAME_CHECK_TIMEOUT_MS = 4_000;
/** How long an answer is reused; a failed request is retried sooner. */
export const FRAME_CACHE_MS = 10 * 60_000;
export const FRAME_RETRY_MS = 60_000;
const CACHE_LIMIT = 500;

const cache = new Map<string, { until: number; answer: FrameAnswer }>();

/** Clears the answer cache (tests). */
export function clearFrameCache(): void {
  cache.clear();
}

/** Whether `url` may be framed by the River at `ancestorOrigin`, and the URL to frame (after redirects). */
export async function checkFraming(url: string, ancestorOrigin: string, deps: FrameCheckDeps = {}): Promise<FrameAnswer> {
  const now = deps.now ?? Date.now;
  const key = `${ancestorOrigin} ${url}`;
  const hit = cache.get(key);
  if (hit && hit.until > now()) return hit.answer;

  const answer = await ask(url, ancestorOrigin, deps.guard ?? getFetchGuard());
  const ttl = answer.frame || answer.reason !== "unreachable" ? FRAME_CACHE_MS : FRAME_RETRY_MS;
  cache.delete(key);
  cache.set(key, { until: now() + ttl, answer });
  // Oldest first: a Map keeps insertion order.
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return answer;
}

async function ask(url: string, ancestorOrigin: string, guard: FetchGuard): Promise<FrameAnswer> {
  let res: Response;
  try {
    res = await guard.fetch(url, {
      headers: { accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(FRAME_CHECK_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof FetchError || (err instanceof DOMException && err.name === "TimeoutError")) {
      return { frame: false, reason: "unreachable" };
    }
    throw err;
  }
  // Only the headers matter; the guard has already read the body within its cap.
  void res.body?.cancel();
  if (!res.ok) return { frame: false, reason: "unreachable" };
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const attachment = /^\s*attachment/i.test(res.headers.get("content-disposition") ?? "");
  if (!/^(text\/html|application\/xhtml\+xml)\b/.test(type) || attachment) return { frame: false, reason: "not_page" };
  const finalUrl = res.url || url;
  return framingAllowed(res.headers, finalUrl, ancestorOrigin)
    ? { frame: true, url: finalUrl }
    : { frame: false, reason: "refused" };
}
