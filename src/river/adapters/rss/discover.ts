// Feed autodiscovery (M12): a web page names its feeds with
//   <link rel="alternate" type="application/rss+xml" href="…">  (or application/atom+xml)
// in its <head> (RSS Advisory Board, "RSS Autodiscovery"). This reads those tags from the page's
// text without running or rendering it; hrefs are resolved against the page URL and only https
// ones are kept.
import { decodeEntities } from "./xml.js";

/** The link types read (JSON Feed isn't). */
export const FEED_TYPES: readonly string[] = ["application/rss+xml", "application/atom+xml"];

/** Most feeds a page may name that the follow box tries. */
export const MAX_DISCOVERED = 3;

const LINK_TAG = /<link\b([^>]*)>/gi;
const ATTRIBUTE = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function attributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(ATTRIBUTE)) {
    const name = m[1]?.toLowerCase();
    if (name && !(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
  return attrs;
}

/** The https feed URLs a page names (RSS and Atom; JSON Feed isn't read), in page order. */
export function discoverFeeds(html: string, pageUrl: string): string[] {
  // Only the head matters, and it comes first; don't scan a whole 2 MB page.
  const head = html.slice(0, 256 * 1024);
  const found: string[] = [];
  for (const m of head.matchAll(LINK_TAG)) {
    const attrs = attributes(m[1] ?? "");
    const rels = (attrs.rel ?? "").toLowerCase().split(/\s+/);
    const type = (attrs.type ?? "").toLowerCase().split(";")[0]?.trim();
    if (!rels.includes("alternate") || !FEED_TYPES.includes(type ?? "")) continue;
    if (!attrs.href) continue;
    try {
      const url = new URL(attrs.href, pageUrl);
      if (url.protocol === "https:" && !found.includes(url.toString())) found.push(url.toString());
    } catch {
      // Not a URL: skip it.
    }
  }
  return found.slice(0, MAX_DISCOVERED);
}

/** True when the response looks like an HTML page rather than a feed. */
export function looksLikeHtml(contentType: string | null, text: string): boolean {
  if (contentType && /text\/html|application\/xhtml\+xml/i.test(contentType)) return true;
  return /^\s*(?:<!doctype html|<html[\s>])/i.test(text.slice(0, 1024));
}
