// Boost cards with the post they boost (spec 4.3 "Map"). An Announce usually names the boosted
// object by its IRI only, which left an empty card. During the refresh, each boost's object is
// fetched through the guard and its kind, text and media go into the boost item; then the object's
// author (the actor document, or, when a Mastodon server refuses unsigned actor reads, its account
// lookup) gives the card the original author's name, handle and avatar.
//
// Every request takes one dereference from the refresh's budget (20 per source per refresh, shared
// with a PeerTube channel's own videos). Boosts are taken newest first. A boost whose object can't
// be read (deleted, private, refused, unreachable, or past the budget) stays as it was. Nothing
// here throws.
//
// The item keeps the Announce's id, time and booster (`author`), so stop-at-known and the feed's
// order don't change; the original author goes in `boostOf.author`.
import type { FetchGuard } from "../../../shared/fetch/index.js";
import type { BoostRef, ItemAuthor, NormalizedItem } from "../../../shared/items/index.js";
import { toPlainText } from "../../../shared/sanitize/index.js";
import { ACTIVITY_JSON, asList, hostOf, idOf, isObject } from "./activitypub.js";
import { dereferenceBoost, type BoostBudget } from "./boosts.js";
import { getJson } from "./http.js";
import { formatHandle } from "./input.js";
import type { CachedActor } from "./manifest.js";
import { asActor, cachedFromAccount, cachedFromActor, mastodonLookup, nameFromUrl } from "./resolve.js";

/** Boosts filled at once. The guard still allows at most 2 requests per host. */
export const BOOST_FILL_CONCURRENCY = 4;

export interface BoostFillContext {
  guard: FetchGuard;
  now: Date;
  budget: BoostBudget;
}

type Boost = NormalizedItem & { boostOf: BoostRef };

function isBoost(item: NormalizedItem): item is Boost {
  return item.boostOf !== undefined && !item.hidden;
}

/** A boost that carries nothing of the boosted post (the Announce named it by IRI). */
function needsObject(item: Boost): boolean {
  return !item.contentHtml && !item.summary && !item.title && item.media.length === 0;
}

/** The boosted post's author to read, when the post is known but its author has no name yet. */
function authorToRead(item: Boost): string | undefined {
  if (needsObject(item) || item.boostOf.author?.name) return undefined;
  const url = item.boostOf.author?.url;
  // An object may only name an author on its own host; anything else could put words in
  // another server's account's mouth.
  return url && hostOf(url) === item.boostOf.host ? url : undefined;
}

function plainName(value: string | undefined): string | undefined {
  const text = value ? toPlainText(value).trim().slice(0, 200) : "";
  return text === "" ? undefined : text;
}

function authorFrom(actor: CachedActor): ItemAuthor {
  return {
    ...(plainName(actor.name ?? actor.preferredUsername) ? { name: plainName(actor.name ?? actor.preferredUsername) } : {}),
    ...(actor.handle ? { handle: actor.handle } : {}),
    url: actor.url ?? actor.id,
    ...(actor.iconUrl ? { iconUrl: actor.iconUrl } : {}),
  };
}

/**
 * The boosted post's author, read at `actorUrl`: the actor document, or on a 401/403 the Mastodon
 * account lookup for the name in the URL, accepted only when the account's uri is `actorUrl`.
 * Each request takes one dereference. Undefined when it can't be read.
 */
async function readAuthor(actorUrl: string, ctx: BoostFillContext): Promise<ItemAuthor | undefined> {
  const host = hostOf(actorUrl);
  if (!host || !ctx.budget.take()) return undefined;
  try {
    const res = await getJson(ctx.guard, actorUrl, ACTIVITY_JSON);
    if (res.status === 200) {
      const actor = asActor(res.body, res.url);
      if (!actor || actor.id !== actorUrl) return undefined;
      const username = typeof actor.preferredUsername === "string" ? actor.preferredUsername : undefined;
      return authorFrom(cachedFromActor(actor, username ? formatHandle(username, host) : undefined, ctx.now));
    }
    if (res.status !== 401 && res.status !== 403) return undefined;
    const name = nameFromUrl(actorUrl);
    if (!name || !ctx.budget.take()) return undefined;
    const account = await mastodonLookup(ctx.guard, host, name);
    if (account.uri !== actorUrl) return undefined;
    return authorFrom(cachedFromAccount(account, formatHandle(account.username ?? name, host), ctx.now));
  } catch {
    return undefined;
  }
}

/** The boost item with the boosted post's kind, text, media and link. */
function withObject(item: Boost, post: NormalizedItem): Boost {
  const object = isObject(post.raw) ? post.raw : {};
  const authorUrl = asList(object.attributedTo)
    .map(idOf)
    .find((id) => id !== undefined && hostOf(id) === item.boostOf.host);
  const url = post.url ?? item.boostOf.url;
  const boostOf: BoostRef = {
    ...item.boostOf,
    ...(url ? { url } : {}),
    ...(authorUrl ? { author: { url: authorUrl } } : {}),
  };
  const filled: Boost = {
    ...item,
    kind: post.kind,
    url: url ?? item.url,
    media: post.media,
    boostOf,
    raw: { announce: item.raw, object },
  };
  delete filled.title;
  delete filled.summary;
  delete filled.contentHtml;
  if (post.title) filled.title = post.title;
  if (post.summary) filled.summary = post.summary;
  if (post.contentHtml) filled.contentHtml = post.contentHtml;
  return filled;
}

async function fillOne(
  item: Boost,
  ctx: BoostFillContext,
  authors: Map<string, Promise<ItemAuthor | undefined>>,
): Promise<Boost | undefined> {
  let filled = item;
  if (needsObject(item)) {
    const result = await dereferenceBoost(item.boostOf, ctx);
    if (!result.ok) return undefined;
    filled = withObject(item, result.item);
  }
  const actorUrl = authorToRead(filled);
  if (actorUrl) {
    let pending = authors.get(actorUrl);
    if (!pending) {
      pending = readAuthor(actorUrl, ctx);
      authors.set(actorUrl, pending);
    }
    const author = await pending;
    if (author) filled = { ...filled, boostOf: { ...filled.boostOf, author: { ...filled.boostOf.author, ...author } } };
  }
  return filled === item ? undefined : filled;
}

/**
 * Fills the visible boosts in `items` (newest first, as an outbox lists them) with the posts they
 * boost. Returns only the items that changed, in their order in `items`.
 */
export async function fillBoosts(items: readonly NormalizedItem[], ctx: BoostFillContext): Promise<NormalizedItem[]> {
  const queue = items.filter(isBoost).filter((item) => needsObject(item) || authorToRead(item) !== undefined);
  const filled = new Map<string, NormalizedItem>();
  const authors = new Map<string, Promise<ItemAuthor | undefined>>();
  let next = 0;
  const worker = async () => {
    while (next < queue.length && ctx.budget.remaining() > 0) {
      const item = queue[next++] as Boost;
      const result = await fillOne(item, ctx, authors);
      if (result) filled.set(item.sourceId, result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(BOOST_FILL_CONCURRENCY, queue.length) }, worker));
  return items.flatMap((item) => filled.get(item.sourceId) ?? []);
}
