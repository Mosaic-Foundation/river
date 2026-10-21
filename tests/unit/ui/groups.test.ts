import { describe, expect, it } from "vitest";
import type { FeedItem } from "../../../ui/src/lib/api";
import { groupIds, groupItems } from "../../../ui/src/lib/groups";

// ui-revisions-1 item 7: hub activities of one stream fold into one card, the newest leading.
let n = 0;
function item(patch: { adapter?: string; space?: string; streamKey?: string | null } = {}): FeedItem {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    kind: "civic",
    publishedAt: new Date(Date.UTC(2026, 9, 21) - n * 60_000).toISOString(),
    title: null,
    summary: null,
    contentHtml: null,
    url: null,
    streamKey: patch.streamKey === undefined ? "https://hub.example/process/proc_a" : patch.streamKey,
    author: null,
    media: [],
    boostOf: null,
    civic: null,
    isFinalResult: false,
    source: "live",
    space: { id: patch.space ?? "s1", name: "Hub", iconUrl: null, category: "civic", adapter: patch.adapter ?? "civic_hub" },
  };
}

describe("groupItems", () => {
  it("folds a hub stream's activities into its newest, keeping feed order", () => {
    const a1 = item();
    const other = item({ adapter: "fediverse", streamKey: null });
    const b1 = item({ streamKey: "https://hub.example/process/proc_b" });
    const a2 = item();
    const a3 = item();
    const groups = groupItems([a1, other, b1, a2, a3]);
    expect(groups.map((g) => g.lead.id)).toEqual([a1.id, other.id, b1.id]);
    expect(groups[0]!.earlier.map((i) => i.id)).toEqual([a2.id, a3.id]);
    expect(groupIds(groups[0]!)).toEqual([a1.id, a2.id, a3.id]);
    expect(groups[1]!.earlier).toEqual([]);
  });

  it("never groups across spaces, without a stream, or outside hubs", () => {
    const key = "https://hub.example/process/proc_c";
    const items = [
      item({ streamKey: key }),
      item({ streamKey: key, space: "s2" }),
      item({ streamKey: null }),
      item({ streamKey: null }),
      item({ adapter: "fediverse", streamKey: key }),
      item({ adapter: "fediverse", streamKey: key }),
    ];
    expect(groupItems(items)).toHaveLength(6);
  });
});
