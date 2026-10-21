// What the follow box hands the fediverse adapter (spec F6, 4.3): handles and profile URLs.
import { describe, expect, it } from "vitest";
import { fediverseAdapter, parseInput } from "../../src/river/adapters/fediverse/index.js";

describe("fediverse accepts()", () => {
  it.each([
    "@w3c@w3c.social",
    "  @eff@mastodon.social ",
    "acct:swf@socialwebfoundation.org",
    "@Wikipedia@Wikis.World",
    "https://w3c.social/@w3c",
    "https://mastodon.social/users/eff",
    "https://socialwebfoundation.org/@swf",
    "https://peertube.example/video-channels/news",
    "https://lemmy.example/c/fediverse",
    "https://blog.example/author/alice/",
  ])("accepts %s", (input) => {
    expect(fediverseAdapter.accepts(input)).toBe(true);
  });

  it.each([
    "eff@mastodon.social", // could be an email address; the River never takes those
    "@eff",
    "@eff@localhost",
    "@e ff@mastodon.social",
    "@eff@mastodon.social/path",
    "http://w3c.social/@w3c",
    "https://demosville.civic.social",
    "https://longmont.civic.social/process/abc",
    "https://w3c.social/@w3c/117474632938181298",
    "https://user:pw@w3c.social/@w3c",
    "not a url",
  ])("does not accept %s", (input) => {
    expect(fediverseAdapter.accepts(input)).toBe(false);
  });

  it("normalizes a handle's server to lower case and keeps the name", () => {
    expect(parseInput("@Wikipedia@Wikis.World")).toEqual({ kind: "handle", name: "Wikipedia", server: "wikis.world" });
  });

  it("reads the account name from a profile URL", () => {
    expect(parseInput("https://w3c.social/@w3c#top")).toEqual({ kind: "url", url: "https://w3c.social/@w3c", name: "w3c" });
  });
});
