// The reader view's address (ui-revisions-1 item 1): /item/{id}, keeping the feed's query string
// so the mode and filters survive. vercel.json already serves index.html for every path.

const ITEM_PATH = /^\/item\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** The item id in a path such as /item/{uuid}, or null. */
export function itemIdFromPath(pathname: string): string | null {
  return ITEM_PATH.exec(pathname)?.[1]?.toLowerCase() ?? null;
}

export function itemPath(id: string, search = ""): string {
  return `/item/${id}${search}`;
}

/** A click that should open a new tab or window instead (modifier keys, middle button). */
export function isNewTabClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

/** Elements inside a card that keep their own behavior when clicked. */
export const CARD_INTERACTIVE = "a, button, input, select, textarea, summary, label, video, audio, [role='button']";
