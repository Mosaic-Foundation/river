// How an item opens (ui-revisions-3 items 1 and 2, revising ui-revisions-2 item 2). Fediverse
// posts stay in the feed: their card opens nothing, and "Open ↗" opens the original in a new tab.
// Any other live https page is framed in the embedded view when the server's framing check
// (GET /api/items/{id}/frame, ADR-008) allows it, and opens in a new tab when it refuses. Samples
// and items without a live https URL have no original; only their own address shows the reader.
import type { FeedItem } from "./api";

type Openable = Pick<FeedItem, "url" | "source" | "space">;

export type FramePlan = { kind: "none" } | { kind: "check" } | { kind: "reader" };

/** What opening `item` can do: nothing in the River (fediverse), a framing check, or the reader. */
export function framePlan(item: Openable): FramePlan {
  if (item.source !== "live" || !isHttpsUrl(item.url)) return { kind: "reader" };
  if (item.space.adapter === "fediverse") return { kind: "none" };
  return { kind: "check" };
}

/**
 * What a click on a card does: nothing; open the embedded view (its check still pending, or
 * allowed); or open the original in a new tab (the check refused).
 */
export type CardOpen = "none" | "pending" | "frame" | "tab";

/** `answer` is the framing check's: undefined while unknown, the URL to frame, or null. */
export function cardOpen(item: Openable, answer: string | null | undefined): CardOpen {
  if (framePlan(item).kind !== "check") return "none";
  if (answer === undefined) return "pending";
  return isHttpsUrl(answer) ? "frame" : "tab";
}

/** Only https pages are ever framed (CSP frame-src https:) or offered in a new tab. */
export function isHttpsUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

/** Opens the original in a new tab, in the click itself, so popup blockers allow it. */
export function openInNewTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
