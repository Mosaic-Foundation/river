// Related hub cards (ui-revisions-1 item 7): hub activities about the same process or meeting
// (the same hub stream: space and stream key) show as one card. Items arrive newest first, so the
// first item of a stream leads with the latest status and the later ones fold into it. Anything
// that isn't a hub activity with a stream stays a card of its own. Pure: tests/unit/ui/ covers it.
import type { FeedItem } from "./api";

export interface CardGroup {
  lead: FeedItem;
  /** The stream's older activities, newest first. */
  earlier: FeedItem[];
}

function groupKey(item: FeedItem): string | undefined {
  return item.space.adapter === "civic_hub" && item.streamKey ? `${item.space.id} ${item.streamKey}` : undefined;
}

export function groupItems(items: readonly FeedItem[]): CardGroup[] {
  const groups: CardGroup[] = [];
  const byKey = new Map<string, CardGroup>();
  for (const item of items) {
    const key = groupKey(item);
    const existing = key ? byKey.get(key) : undefined;
    if (existing) {
      existing.earlier.push(item);
      continue;
    }
    const group: CardGroup = { lead: item, earlier: [] };
    groups.push(group);
    if (key) byKey.set(key, group);
  }
  return groups;
}

/** Every item id in a group, the lead first. */
export function groupIds(group: CardGroup): string[] {
  return [group.lead.id, ...group.earlier.map((i) => i.id)];
}
