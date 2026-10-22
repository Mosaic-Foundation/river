// How an opened item shows (ui-revisions-2 item 2): framed in the embedded view, or in the reader.
// A Mastodon post frames its own /embed page at once; any other live https page is framed only
// after the server's framing check (GET /api/items/{id}/frame, ADR-008) says its headers allow
// it; samples and items without a live https URL open in the reader.
import type { FeedItem } from "./api";

/** Mastodon status pages: /@name/{id} and the ActivityPub id form /users/{name}/statuses/{id}. */
const MASTODON_STATUS = /^\/(?:@[^/]+|users\/[^/]+\/statuses)\/\d+\/?$/;

/** A fediverse post's Mastodon embed URL ({status url}/embed), or null for anything else. */
export function mastodonEmbedUrl(item: Pick<FeedItem, "url" | "source" | "space">): string | null {
  if (item.source !== "live" || item.space.adapter !== "fediverse" || !item.url) return null;
  let url: URL;
  try {
    url = new URL(item.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.search || url.hash || !MASTODON_STATUS.test(url.pathname)) return null;
  return `${url.origin}${url.pathname.replace(/\/$/, "")}/embed`;
}

export type FramePlan = { kind: "frame"; src: string } | { kind: "check" } | { kind: "reader" };

/** What opening `item` does before any check: frame it now, ask the server, or read it here. */
export function framePlan(item: Pick<FeedItem, "url" | "source" | "space">): FramePlan {
  const embed = mastodonEmbedUrl(item);
  if (embed) return { kind: "frame", src: embed };
  if (item.source === "live" && isHttpsUrl(item.url)) return { kind: "check" };
  return { kind: "reader" };
}

/** Only https pages are ever framed (CSP frame-src https:). */
export function isHttpsUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}
