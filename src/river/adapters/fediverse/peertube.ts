// PeerTube channels (M12). A channel is a Group actor; its outbox lists each of its videos as an
// Announce whose object is the video's IRI, not an embedded Video (an account's outbox has Create
// Video instead, which map.ts already reads). Read as a plain boost, every video would be an empty
// "boosted a post" card. So, for a PeerTube space only, an Announce of a video on the channel's
// own host and attributed to the channel itself is read as the channel publishing it: the Video
// is fetched (through the guard, at most OWN_VIDEO_LIMIT per refresh) and becomes a `video` item,
// keyed by the Announce's id so stop-at-known still works. Anything else stays a boost card, and
// nothing changes for other servers.
import type { FetchGuard } from "../../../shared/fetch/index.js";
import type { ItemAuthor, NormalizedItem } from "../../../shared/items/index.js";
import { ACTIVITY_JSON, asList, hostOf, idOf, isObject } from "./activitypub.js";
import { createBoostBudget, type BoostBudget } from "./boosts.js";
import { getJson } from "./http.js";
import { mapObject } from "./map.js";

/** Videos a channel's refresh may fetch (the same cap as boosts, spec 4.3). */
export const OWN_VIDEO_LIMIT = 20;

export function isPeerTube(network: string | null | undefined): boolean {
  return network?.toLowerCase() === "peertube";
}

export function createOwnVideoBudget(): BoostBudget {
  return createBoostBudget(OWN_VIDEO_LIMIT);
}

export interface ChannelContext {
  guard: FetchGuard;
  now: Date;
  /** The channel's actor id. */
  actorId: string;
  author?: ItemAuthor;
  budget: BoostBudget;
}

/** True when the Announce item is the channel sharing something on its own host. */
function isOwnShare(item: NormalizedItem, actorHost: string): boolean {
  return item.boostOf !== undefined && !item.hidden && item.boostOf.host === actorHost && !item.contentHtml;
}

/** Fetches one shared video; the item it becomes, or undefined to keep the boost card. */
async function readOwnVideo(item: NormalizedItem, ctx: ChannelContext): Promise<NormalizedItem | undefined> {
  const objectId = item.boostOf?.objectId;
  if (!objectId || !ctx.budget.take()) return undefined;
  let res;
  try {
    res = await getJson(ctx.guard, objectId, ACTIVITY_JSON);
  } catch {
    return undefined;
  }
  // The object must come from the host its id names, and be the channel's own.
  if (res.status !== 200 || hostOf(res.url) !== hostOf(objectId) || !isObject(res.body)) return undefined;
  const attributedTo = asList(res.body.attributedTo).map(idOf);
  if (!attributedTo.includes(ctx.actorId)) return undefined;
  const video = mapObject(res.body, { now: ctx.now });
  if (!video || video.hidden || (video.kind !== "video" && video.kind !== "podcast")) return undefined;
  const { boostOf: _boostOf, ...rest } = video;
  return {
    ...rest,
    sourceId: item.sourceId,
    author: ctx.author ?? video.author,
    raw: { announce: item.raw, object: res.body },
  };
}

/** Replaces the channel's own shares in `items` with the videos they announce (in place order). */
export async function readChannelVideos(items: NormalizedItem[], ctx: ChannelContext): Promise<NormalizedItem[]> {
  const actorHost = hostOf(ctx.actorId);
  if (!actorHost) return items;
  return Promise.all(
    items.map(async (item) => (isOwnShare(item, actorHost) ? ((await readOwnVideo(item, ctx)) ?? item) : item)),
  );
}
