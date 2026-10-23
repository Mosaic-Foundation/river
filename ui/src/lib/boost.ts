// Boost cards (spec 4.3 "Map"). When the refresh read the boosted post from its own host
// (`boostOf.fetched`), the card and the reader show it as its original author posted it (their
// name and avatar, its text and media), under a small "{booster} boosted" line. Otherwise it keeps
// the plain card, "{booster} boosted a post from {host}", under the booster's name: any text it
// carries came from the booster's server, so it is never shown under the original author.
import type { FeedItem, ItemAuthor } from "./api";

export interface BoostedPost {
  /** Who boosted it: the followed account. */
  booster: string;
  /** The original author's name, else their handle, else the host the post lives on. */
  name: string;
  author: ItemAuthor | null;
}

/** What a boost is called where it happened: a Bluesky repost, a fediverse boost. */
export function boostVerb(item: Pick<FeedItem, "space">): "reposted" | "boosted" {
  return item.space.adapter === "atproto" ? "reposted" : "boosted";
}

/** The name on a boost line: the followed account that boosted. */
export function boosterName(item: FeedItem): string {
  return item.author?.name || item.space.name;
}

/** The boosted post, when it was read from its own host; undefined for other items and plain boosts. */
export function boostedPost(item: FeedItem): BoostedPost | undefined {
  const boost = item.boostOf;
  if (!boost?.fetched) return undefined;
  const author = boost.author ?? null;
  return { booster: boosterName(item), name: author?.name || author?.handle || boost.host, author };
}
