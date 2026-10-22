// Boost cards (spec 4.3 "Map"). When the refresh fetched the boosted post, the card and the reader
// show it as its original author posted it (their name and avatar, its text and media), under a
// small "{booster} boosted" line. When it couldn't be fetched, the item carries nothing of the
// post and keeps the plain card: "{booster} boosted a post from {host}".
import type { FeedItem, ItemAuthor } from "./api";

export interface BoostedPost {
  /** Who boosted it: the followed account. */
  booster: string;
  /** The original author's name, else their handle, else the host the post lives on. */
  name: string;
  author: ItemAuthor | null;
}

/** The name on a boost line: the followed account that boosted. */
export function boosterName(item: FeedItem): string {
  return item.author?.name || item.space.name;
}

/** The boosted post, when the item carries it; undefined for other items and for plain boosts. */
export function boostedPost(item: FeedItem): BoostedPost | undefined {
  const boost = item.boostOf;
  if (!boost) return undefined;
  const carriesPost = Boolean(item.contentHtml || item.summary || item.title || item.media.length > 0);
  if (!carriesPost) return undefined;
  const author = boost.author ?? null;
  return { booster: boosterName(item), name: author?.name || author?.handle || boost.host, author };
}
