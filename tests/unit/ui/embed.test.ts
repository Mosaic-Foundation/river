import { describe, expect, it } from "vitest";
import type { FeedItem } from "../../../ui/src/lib/api";
import { cardOpen, framePlan, isHttpsUrl } from "../../../ui/src/lib/embed";

// ui-revisions-3 items 1 and 2: fediverse posts stay in the feed (no framing, "Open ↗" only);
// other live https pages are framed when the server's check allows it and open in a new tab when
// it refuses; samples and items without a live https URL have nothing to open.
type Openable = Pick<FeedItem, "url" | "source" | "space">;

function item(url: string | null, adapter = "civic_hub", source: "live" | "sample" = "live"): Openable {
  return { url, source, space: { id: "s", name: "Longmont", iconUrl: null, category: null, adapter } };
}

describe("framePlan", () => {
  it("fediverse posts are never framed or checked, Mastodon or not", () => {
    for (const url of [
      "https://mastodon.social/@eff/117476104123038281",
      "https://mas.to/users/sphcow/statuses/117451397579521952",
      "https://socialwebfoundation.org/2026/10/13/fosdem-2027-dev-room-application-is-in/",
    ]) {
      expect(framePlan(item(url, "fediverse")), url).toEqual({ kind: "none" });
    }
  });

  it("other live https pages are checked; samples and pages without https read in the reader", () => {
    expect(framePlan(item("https://longmont.civic.social/process/p1"))).toEqual({ kind: "check" });
    expect(framePlan(item("https://synthetic-podcast.example/episodes/3", "rss"))).toEqual({ kind: "check" });
    expect(framePlan(item(null, "sample", "sample"))).toEqual({ kind: "reader" });
    expect(framePlan(item(null))).toEqual({ kind: "reader" });
    expect(framePlan(item("http://example.org/post"))).toEqual({ kind: "reader" });
  });
});

describe("cardOpen", () => {
  it("is pending until the check answers, then frames an allowed page or opens a tab", () => {
    const hub = item("https://longmont.civic.social/process/p1");
    expect(cardOpen(hub, undefined)).toBe("pending");
    expect(cardOpen(hub, "https://longmont.civic.social/process/p1")).toBe("frame");
    expect(cardOpen(hub, null)).toBe("tab");
    // An answer that isn't an https URL never frames.
    expect(cardOpen(hub, "javascript:alert(1)")).toBe("tab");
  });

  it("does nothing for fediverse posts and samples, whatever the answer", () => {
    expect(cardOpen(item("https://mastodon.social/@eff/1", "fediverse"), "https://mastodon.social/@eff/1")).toBe("none");
    expect(cardOpen(item(null, "sample", "sample"), undefined)).toBe("none");
  });
});

describe("isHttpsUrl", () => {
  it("accepts only https URLs", () => {
    expect(isHttpsUrl("https://example.org/")).toBe(true);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("http://example.org/")).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
  });
});
