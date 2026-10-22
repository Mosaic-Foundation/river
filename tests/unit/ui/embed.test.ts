import { describe, expect, it } from "vitest";
import type { FeedItem } from "../../../ui/src/lib/api";
import { framePlan, isHttpsUrl, mastodonEmbedUrl } from "../../../ui/src/lib/embed";

// ui-revisions-2 item 2: how an opened item shows. A Mastodon post frames its own /embed page;
// another live https page waits for the server's framing check; anything else reads in the reader.
type Openable = Pick<FeedItem, "url" | "source" | "space">;

function item(url: string | null, patch: Partial<Openable> = {}): Openable {
  return {
    url,
    source: "live",
    space: { id: "s", name: "EFF", iconUrl: null, category: null, adapter: "fediverse" },
    ...patch,
  };
}

describe("mastodonEmbedUrl", () => {
  it("is {status url}/embed for both forms of a Mastodon status URL", () => {
    expect(mastodonEmbedUrl(item("https://mastodon.social/@eff/117476104123038281"))).toBe(
      "https://mastodon.social/@eff/117476104123038281/embed",
    );
    expect(mastodonEmbedUrl(item("https://mas.to/users/sphcow/statuses/117451397579521952"))).toBe(
      "https://mas.to/users/sphcow/statuses/117451397579521952/embed",
    );
    expect(mastodonEmbedUrl(item("https://w3c.social/@w3cdevs/117471856565477515/"))).toBe(
      "https://w3c.social/@w3cdevs/117471856565477515/embed",
    );
  });

  it("is null for other fediverse software, other adapters, samples and non-https URLs", () => {
    for (const url of [
      "https://socialwebfoundation.org/2026/10/13/fosdem-2027-dev-room-application-is-in/",
      "https://piaille.fr/ap/users/116431554677188361/statuses/117393933041100983",
      "https://gts.example/@ann/statuses/01HXYZ",
      "https://mastodon.social/@eff",
      "https://mastodon.social/@eff/117476104123038281?x=1",
      "http://mastodon.social/@eff/117476104123038281",
      "not a url",
    ]) {
      expect(mastodonEmbedUrl(item(url)), url).toBeNull();
    }
    const hub = { id: "h", name: "Longmont", iconUrl: null, category: "civic", adapter: "civic_hub" };
    expect(mastodonEmbedUrl(item("https://longmont.civic.social/@x/1", { space: hub }))).toBeNull();
    expect(mastodonEmbedUrl(item("https://mastodon.social/@eff/1", { source: "sample" }))).toBeNull();
  });
});

describe("framePlan", () => {
  it("frames a Mastodon post now, checks other live https pages, reads the rest", () => {
    expect(framePlan(item("https://mastodon.social/@eff/1"))).toEqual({ kind: "frame", src: "https://mastodon.social/@eff/1/embed" });
    expect(framePlan(item("https://socialwebfoundation.org/a/"))).toEqual({ kind: "check" });
    expect(framePlan(item(null, { source: "sample" }))).toEqual({ kind: "reader" });
    expect(framePlan(item(null))).toEqual({ kind: "reader" });
    expect(framePlan(item("http://example.org/post"))).toEqual({ kind: "reader" });
  });

  it("isHttpsUrl accepts only https URLs", () => {
    expect(isHttpsUrl("https://example.org/")).toBe(true);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("http://example.org/")).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
  });
});
