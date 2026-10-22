import { describe, expect, it } from "vitest";
import type { FeedItem } from "../../../ui/src/lib/api";
import { boostedPost, boosterName } from "../../../ui/src/lib/boost";

// Spec 4.3: a boost the refresh filled reads as the original post, under "{booster} boosted".
function boost(patch: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "post",
    publishedAt: "2026-10-21T00:00:00Z",
    title: null,
    summary: null,
    contentHtml: null,
    url: "https://w3c.social/users/w3cdevs/statuses/1",
    streamKey: null,
    author: { name: "W3C", handle: "@w3c@w3c.social" },
    media: [],
    boostOf: { objectId: "https://w3c.social/users/w3cdevs/statuses/1", host: "w3c.social" },
    civic: null,
    isFinalResult: false,
    source: "live",
    space: { id: "s1", name: "W3C space", iconUrl: null, category: "organization", adapter: "fediverse" },
    ...patch,
  };
}

const AUTHOR = {
  name: "W3C Developers",
  handle: "@w3cdevs@w3c.social",
  url: "https://w3c.social/@w3cdevs",
  iconUrl: "https://w3c.social/avatars/w3cdevs.png",
};

describe("boostedPost", () => {
  it("is undefined for a plain boost (the post couldn't be fetched) and for non-boosts", () => {
    expect(boostedPost(boost())).toBeUndefined();
    expect(boostedPost(boost({ boostOf: null, contentHtml: "<p>Own post</p>" }))).toBeUndefined();
  });

  it("names the original author and the booster when the boost carries the post", () => {
    const item = boost({ contentHtml: "<p>Hello</p>", boostOf: { ...boost().boostOf!, author: AUTHOR } });
    expect(boostedPost(item)).toEqual({ booster: "W3C", name: "W3C Developers", author: AUTHOR });
  });

  it("counts media alone as carrying the post", () => {
    const item = boost({ kind: "photo", media: [{ type: "image", url: "https://w3c.social/a.png", alt: "A chart" }] });
    expect(boostedPost(item)?.name).toBe("w3c.social");
  });

  it("falls back to the author's handle, then the post's host", () => {
    const withHandle = boost({ contentHtml: "<p>Hi</p>", boostOf: { ...boost().boostOf!, author: { handle: "@x@w3c.social" } } });
    expect(boostedPost(withHandle)?.name).toBe("@x@w3c.social");
    const anonymous = boost({ contentHtml: "<p>Hi</p>", boostOf: { ...boost().boostOf!, author: { url: "https://w3c.social/users/x" } } });
    expect(boostedPost(anonymous)?.name).toBe("w3c.social");
  });
});

describe("boosterName", () => {
  it("is the boosting account's name, else the space's", () => {
    expect(boosterName(boost())).toBe("W3C");
    expect(boosterName(boost({ author: null }))).toBe("W3C space");
  });
});
