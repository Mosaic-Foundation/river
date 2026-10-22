// fetchNew (spec 4.3 "Fetch" and "Fallback"): the outbox's first page, then at most one more,
// stopping at the first item already stored. Never `min_id` (Mastodon-only; WordPress pages by
// number). When the unsigned outbox read is refused (401/403): Mastodon's REST API if NodeInfo
// says Mastodon, otherwise the space is `blocked` (server-only).
//
// Boosts the outbox names only by IRI are then filled with the posts they boost (boostContent.ts),
// within one budget of 20 dereferences per refresh (spec 4.3) that a PeerTube channel's own videos
// share. Each page is stored as it arrives; the filled boosts are passed to onPage again after the
// last page, so a slow boosted post never holds up the feed.
//
// The 120 s minimum between refreshes of one space is the refresh's job (M5, spec 4.5), not this
// module's. A 429 is reported as an error; the guard keeps the host's Retry-After.
import type { FetchGuard } from "../../../shared/fetch/index.js";
import {
  AdapterError,
  ADAPTER_MESSAGES,
  type FetchContext,
  type FetchResult,
  type ItemAuthor,
  type NormalizedItem,
  type SpaceRecord,
} from "../../../shared/items/index.js";
import { ACTIVITY_JSON, PLAIN_JSON, asList, hostOf, httpsUrl, isObject, type AsObject } from "./activitypub.js";
import { fillBoosts } from "./boostContent.js";
import { createBoostBudget } from "./boosts.js";
import { getJson, objectBody, SERVER_ONLY_MESSAGE, statusError } from "./http.js";
import { isExpired, readManifest, toManifestJson, type FediverseManifest } from "./manifest.js";
import { mapActivity, mapStatus, type MapContext } from "./map.js";
import { isPeerTube, readChannelVideos } from "./peertube.js";
import { isMastodon, mastodonLookup, readActor, readNodeInfo } from "./resolve.js";

export const MAX_PAGES = 2;
/** Statuses per REST fallback read (spec 4.3). */
export const REST_LIMIT = 20;

function authorFrom(manifest: Partial<FediverseManifest>): ItemAuthor | undefined {
  const actor = manifest.actor;
  if (!actor) return undefined;
  return {
    ...(actor.name ?? actor.preferredUsername ? { name: actor.name ?? actor.preferredUsername } : {}),
    ...(actor.handle ? { handle: actor.handle } : {}),
    url: actor.url ?? actor.id,
    ...(actor.iconUrl ? { iconUrl: actor.iconUrl } : {}),
  };
}

/** Maps a page's entries in order, stopping at the first one already stored. */
async function takeUntilKnown(
  entries: unknown[],
  mapCtx: MapContext,
  ctx: FetchContext,
  map: (entry: unknown, mapCtx: MapContext) => NormalizedItem | undefined,
): Promise<{ items: NormalizedItem[]; reachedKnown: boolean }> {
  const items: NormalizedItem[] = [];
  for (const entry of entries) {
    const item = map(entry, mapCtx);
    if (!item) continue;
    if (ctx.isKnown && (await ctx.isKnown(item.sourceId))) return { items, reachedKnown: true };
    items.push(item);
  }
  return { items, reachedKnown: false };
}

function newest(items: NormalizedItem[], previous: Date | null | undefined): Date | undefined {
  let best = previous ?? undefined;
  for (const item of items) {
    if (item.hidden) continue;
    if (!best || item.publishedAt > best) best = item.publishedAt;
  }
  return best ?? undefined;
}

function result(
  items: NormalizedItem[],
  space: SpaceRecord,
  manifest: FediverseManifest | undefined,
  fetchStatus: "ok" | "blocked",
  lastError: string | null,
): FetchResult {
  const newestItemAt = newest(items, space.newestItemAt);
  return {
    items,
    space: {
      fetchStatus,
      lastError,
      ...(newestItemAt ? { newestItemAt } : {}),
      ...(manifest ? { manifest: toManifestJson(manifest) } : {}),
    },
    streams: [],
    notModified: false,
  };
}

/** The page to start from: the collection's `first` (a URL or an embedded page). */
async function firstPage(
  guard: FetchGuard,
  outbox: AsObject,
  outboxUrl: string,
  network: string | undefined,
): Promise<AsObject | undefined> {
  const first = outbox.first;
  if (isObject(first) && Array.isArray(first.orderedItems ?? first.items)) return first;
  const firstUrl = httpsUrl(isObject(first) ? first.id : first);
  if (firstUrl) return objectBody(await pageOrThrow(guard, firstUrl));
  // A collection that lists its items directly.
  if (Array.isArray(outbox.orderedItems ?? outbox.items)) return outbox;
  // Mastodon without `first`: its first page is ?page=true.
  if (isMastodon(network)) {
    const url = new URL(outboxUrl);
    url.searchParams.set("page", "true");
    return objectBody(await pageOrThrow(guard, url.toString()));
  }
  return undefined;
}

async function pageOrThrow(guard: FetchGuard, url: string) {
  const res = await getJson(guard, url, ACTIVITY_JSON);
  if (res.status !== 200) throw statusError(res.status, "unreachable");
  return res;
}

function entriesOf(page: AsObject): unknown[] {
  return asList(page.orderedItems ?? page.items);
}

/** The REST fallback: lookup (unless the manifest has the id), then the latest 20 statuses. */
async function fetchFromMastodonApi(
  space: SpaceRecord,
  ctx: FetchContext,
  manifest: Partial<FediverseManifest>,
  host: string,
  mapCtx: MapContext,
): Promise<{ items: NormalizedItem[]; accountId: string }> {
  let accountId = manifest.mastodonAccountId;
  if (!accountId) {
    const name = manifest.actor?.preferredUsername ?? /\/users\/([^/]+)$/.exec(space.actorId ?? "")?.[1];
    if (!name) throw new AdapterError("server_only", SERVER_ONLY_MESSAGE);
    accountId = (await mastodonLookup(ctx.guard, host, name)).id;
  }
  const url = `https://${host}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses?limit=${REST_LIMIT}&exclude_replies=true`;
  const res = await getJson(ctx.guard, url, PLAIN_JSON);
  if (res.status !== 200) throw statusError(res.status, "unreachable");
  const { items } = await takeUntilKnown(asList(res.body), mapCtx, ctx, (s, m) => mapStatus(s, host, m));
  await ctx.onPage?.(items);
  return { items, accountId };
}

export async function fetchNew(space: SpaceRecord, ctx: FetchContext): Promise<FetchResult> {
  let manifest = readManifest(space.manifest);
  let manifestChanged = false;
  const actorId = space.actorId ?? manifest.actor?.id ?? space.canonicalUrl;
  const host = hostOf(actorId);
  if (!host) throw new AdapterError("refused", ADAPTER_MESSAGES.refused);

  // The cached actor is good for 24 hours (spec 4.3); refresh it when it has expired. Best effort:
  // a failure keeps the old one.
  if (isExpired(manifest.actor, ctx.now)) {
    try {
      const fresh = await readActor(ctx.guard, actorId, ctx.now, {
        handle: manifest.actor?.handle,
        name: manifest.actor?.preferredUsername,
      });
      manifest = {
        ...manifest,
        actor: fresh.actor,
        software: fresh.software ?? manifest.software,
        via: fresh.via,
        mastodonAccountId: fresh.mastodonAccountId ?? manifest.mastodonAccountId,
      };
      manifestChanged = true;
    } catch {
      // Keep what we had.
    }
  }

  const network = space.network ?? manifest.software?.name;
  const mapCtx: MapContext = { author: authorFrom(manifest), now: ctx.now };
  const outboxUrl = space.feedUrl ?? manifest.actor?.outbox;
  const fullManifest = (): FediverseManifest | undefined =>
    manifestChanged && manifest.actor ? ({ via: "activitypub", ...manifest } as FediverseManifest) : undefined;

  const outboxRes = outboxUrl ? await getJson(ctx.guard, outboxUrl, ACTIVITY_JSON) : undefined;

  if (!outboxRes || outboxRes.status === 401 || outboxRes.status === 403) {
    // Spec 4.3 fallback. Look NodeInfo up if resolve didn't record it.
    const software = network ?? (await readNodeInfo(ctx.guard, host))?.name;
    if (!isMastodon(software)) {
      return result([], space, fullManifest(), "blocked", SERVER_ONLY_MESSAGE);
    }
    const { items, accountId } = await fetchFromMastodonApi(space, ctx, manifest, host, mapCtx);
    if (manifest.actor && manifest.mastodonAccountId !== accountId) {
      manifest = { ...manifest, mastodonAccountId: accountId };
      manifestChanged = true;
    }
    return result(items, space, fullManifest(), "ok", null);
  }

  if (outboxRes.status !== 200) throw statusError(outboxRes.status, "unreachable");
  const outbox = objectBody(outboxRes);
  if (!outbox) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);

  const items: NormalizedItem[] = [];
  const budget = createBoostBudget();
  // A PeerTube channel announces its own videos (peertube.ts); other servers are read as before.
  const channel = isPeerTube(network)
    ? { guard: ctx.guard, now: ctx.now, actorId, author: mapCtx.author, budget }
    : undefined;
  let page = await firstPage(ctx.guard, outbox, outboxUrl as string, network);
  for (let n = 1; page && n <= MAX_PAGES; n++) {
    const taken = await takeUntilKnown(entriesOf(page), mapCtx, ctx, mapActivity);
    const pageItems = channel ? await readChannelVideos(taken.items, channel) : taken.items;
    items.push(...pageItems);
    await ctx.onPage?.(pageItems);
    if (taken.reachedKnown || n === MAX_PAGES) break;
    const next = httpsUrl(isObject(page.next) ? page.next.id : page.next);
    if (!next) break;
    page = objectBody(await pageOrThrow(ctx.guard, next));
  }
  const filled = await fillBoosts(items, { guard: ctx.guard, now: ctx.now, budget });
  if (filled.length > 0) {
    const bySourceId = new Map(filled.map((item) => [item.sourceId, item]));
    items.splice(0, items.length, ...items.map((item) => bySourceId.get(item.sourceId) ?? item));
    await ctx.onPage?.(filled);
  }
  return result(items, space, fullManifest(), "ok", null);
}
