// fetchNew (ADR-009 item 4): app.bsky.feed.getAuthorFeed for the space's DID, newest first, without
// replies, PAGE_LIMIT entries a page, at most MAX_PAGES pages, stopping at the first entry already
// stored or older than the retention window (spec 3.1: such items would be deleted anyway). Each
// page is stored as it arrives.
//
// The account's current handle, name and avatar come from the entries themselves (its own posts'
// author, its reposts' `by`), so a handle change reaches the space with no extra request.
//
// The 120 s minimum between refreshes of one space, and the cap on Bluesky spaces per feed open,
// are the refresh's job (spec 4.5, DECISIONS.md), not this module's.
import {
  AdapterError,
  ADAPTER_MESSAGES,
  type FetchContext,
  type FetchResult,
  type NormalizedItem,
  type SpaceRecord,
} from "../../../shared/items/index.js";
import { toPlainText } from "../../../shared/sanitize/index.js";
import { get, httpsUrl, isObject, list, replyError, str, xrpcUrl } from "./http.js";
import { didFromCanonical, normalizeDid, normalizeHandle } from "./input.js";
import { actorChanged, actorFrom, readManifest, toManifestJson, type BlueskyManifest } from "./manifest.js";
import { didOf, mapFeedEntry } from "./map.js";

export const PAGE_LIMIT = 30;
export const MAX_PAGES = 2;
/** Items older than this aren't stored (spec 3.1 retention). */
export const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** The getAuthorFeed URL for a DID (and a cursor). */
export function authorFeedUrl(did: string, cursor?: string): string {
  return xrpcUrl("app.bsky.feed.getAuthorFeed", { actor: did, limit: PAGE_LIMIT, filter: "posts_no_replies", cursor });
}

/** The space's own profile as the newest entry shows it: its post's author, or its repost's `by`. */
function ownProfile(entries: unknown[], did: string): Record<string, unknown> | undefined {
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const by = isObject(entry.reason) ? entry.reason.by : undefined;
    if (didOf(by) === did && isObject(by)) return by;
    const author = isObject(entry.post) ? entry.post.author : undefined;
    if (didOf(author) === did && isObject(author)) return author;
  }
  return undefined;
}

function newest(items: NormalizedItem[], previous: Date | null | undefined): Date | undefined {
  let best = previous ?? undefined;
  for (const item of items) {
    if (item.hidden) continue;
    if (!best || item.publishedAt > best) best = item.publishedAt;
  }
  return best;
}

export async function fetchNew(space: SpaceRecord, ctx: FetchContext): Promise<FetchResult> {
  const did = normalizeDid(space.actorId ?? "") ?? didFromCanonical(space.canonicalUrl);
  if (!did) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  let manifest = readManifest(space.manifest);
  let manifestChanged = false;
  const oldest = ctx.now.getTime() - MAX_AGE_MS;

  const items: NormalizedItem[] = [];
  let cursor: string | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const reply = await get(ctx.guard, authorFeedUrl(did, cursor));
    if (reply.status !== 200 || !isObject(reply.body)) throw replyError(reply);
    const entries = list(reply.body.feed);

    if (page === 1) {
      const profile = ownProfile(entries, did);
      if (profile) {
        const fresh = actorFrom(
          {
            did,
            // The AppView writes "handle.invalid" for a handle that no longer verifies; that TLD
            // isn't a valid handle, so it reads as none.
            handle: normalizeHandle(str(profile.handle) ?? ""),
            displayName: toPlainText(str(profile.displayName)).slice(0, 200) || undefined,
            avatar: httpsUrl(profile.avatar),
          },
          ctx.now,
        );
        if (actorChanged(manifest.actor, fresh)) {
          manifest = { ...manifest, actor: fresh };
          manifestChanged = true;
        }
      }
    }

    const pageItems: NormalizedItem[] = [];
    let stop = false;
    for (const entry of entries) {
      const item = mapFeedEntry(entry, { now: ctx.now });
      if (!item) continue;
      if (item.publishedAt.getTime() < oldest || (ctx.isKnown && (await ctx.isKnown(item.sourceId)))) {
        stop = true;
        break;
      }
      pageItems.push(item);
    }
    items.push(...pageItems);
    await ctx.onPage?.(pageItems);
    cursor = str(reply.body.cursor);
    if (stop || !cursor || entries.length === 0) break;
  }

  const newestItemAt = newest(items, space.newestItemAt);
  return {
    items,
    space: {
      fetchStatus: "ok",
      lastError: null,
      ...(newestItemAt ? { newestItemAt } : {}),
      ...(manifestChanged && manifest.actor ? { manifest: toManifestJson(manifest as BlueskyManifest) } : {}),
    },
    streams: [],
    notModified: false,
  };
}
