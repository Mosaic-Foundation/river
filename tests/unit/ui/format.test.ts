import { describe, expect, it } from "vitest";
import { feedSearch } from "../../../ui/src/lib/api";
import {
  cardImages,
  circleColor,
  CONTENT_TYPES,
  deadlineLabel,
  NETWORKS,
  parseList,
  playableMedia,
  processKey,
  safeMediaUrl,
  toggleValue,
  eventDate,
  formatDuration,
  initials,
  kindLabel,
  linkHost,
  relativeTime,
  safeImageUrl,
  SAMPLE_EXPLAINER,
} from "../../../ui/src/lib/format";

// M6: the River UI's pure card helpers (spec F1, F5, 4.8).
describe("card helpers", () => {
  it("keeps the exact F1 explainer", () => {
    expect(SAMPLE_EXPLAINER).toBe(
      "This isn't linked to a real feed. It's here to show how the River works for a soccer club, a family or a podcast.",
    );
  });

  it("lists F5's content types in order, with the values /api/feed accepts", () => {
    expect(CONTENT_TYPES.map((t) => t.label)).toEqual([
      "Posts", "Articles", "Podcasts", "Videos", "Photos", "Events", "Civic activity",
    ]);
    expect(CONTENT_TYPES.map((t) => t.value)).toEqual([
      "posts", "articles", "podcasts", "videos", "photos", "events", "civic",
    ]);
    expect(NETWORKS.map((n) => n.value)).toEqual(["hubs", "fediverse", "bluesky"]);
  });

  it("plays audio and video from https sources only", () => {
    expect(safeMediaUrl("https://files.example/a.mp4")).toBe("https://files.example/a.mp4");
    for (const bad of ["http://files.example/a.mp4", "javascript:alert(1)", "/samples/a.mp3", "https://u:p@files.example/a.mp4", "", null]) {
      expect(safeMediaUrl(bad)).toBeUndefined();
    }
    const media = [
      { type: "image" as const, url: "https://files.example/a.png" },
      { type: "video" as const, url: "https://files.example/a.mp4" },
      { type: "audio" as const, url: "http://files.example/a.mp3" },
      { type: "audio" as const, url: "https://files.example/b.mp3" },
    ];
    expect(playableMedia(media).map((m) => m.url)).toEqual(["https://files.example/a.mp4", "https://files.example/b.mp3"]);
  });

  it("reads and toggles filter lists in their own order (ui-revisions-1 items 2, 4)", () => {
    expect(parseList("videos,POSTS,memes,posts", CONTENT_TYPES)).toEqual(["posts", "videos"]);
    expect(parseList(null, CONTENT_TYPES)).toEqual([]);
    expect(toggleValue(["videos"], "posts", CONTENT_TYPES)).toEqual(["posts", "videos"]);
    expect(toggleValue(["posts", "videos"], "posts", CONTENT_TYPES)).toEqual(["videos"]);
    expect(toggleValue([], "fediverse", NETWORKS)).toEqual(["fediverse"]);
  });

  it("labels kinds, defaulting to Post", () => {
    expect(kindLabel("civic")).toBe("Civic activity");
    expect(kindLabel("podcast")).toBe("Podcast");
    expect(kindLabel("mystery")).toBe("Post");
  });

  it("labels Open links by the item URL's host, https only", () => {
    expect(linkHost("https://mastodon.social/@eff/1")).toBe("mastodon.social");
    expect(linkHost("https://longmont.civic.social:8443/process/x")).toBe("longmont.civic.social:8443");
    expect(linkHost("http://example.org/a")).toBeUndefined();
    expect(linkHost("javascript:alert(1)")).toBeUndefined();
    expect(linkHost("not a url")).toBeUndefined();
    expect(linkHost(null)).toBeUndefined();
  });

  it("shows images only over https or from the River's own /samples/ (spec 4.8, CSP img-src)", () => {
    expect(safeImageUrl("https://files.mastodon.social/a.png")).toBe("https://files.mastodon.social/a.png");
    expect(safeImageUrl("/samples/soccer-team.svg")).toBe("/samples/soccer-team.svg");
    for (const bad of [
      "http://files.example/a.png",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "/samples/../api/feed",
      "/other/a.png",
      "//evil.example/a.png",
      "",
      null,
      undefined,
    ]) {
      expect(safeImageUrl(bad), String(bad)).toBeUndefined();
    }
  });

  it("picks up to four usable images", () => {
    const media = [
      { type: "image" as const, url: "https://a.example/1.png" },
      { type: "video" as const, url: "https://a.example/v.mp4" },
      { type: "image" as const, url: "http://a.example/2.png" },
      ...[3, 4, 5, 6].map((n) => ({ type: "image" as const, url: `https://a.example/${n}.png` })),
    ];
    expect(cardImages(media).map((m) => m.url)).toEqual([
      "https://a.example/1.png",
      "https://a.example/3.png",
      "https://a.example/4.png",
      "https://a.example/5.png",
    ]);
    expect(cardImages(undefined)).toEqual([]);
  });

  it("makes initials from the first two words, or the first two letters", () => {
    expect(initials("Electronic Frontier Foundation")).toBe("EF");
    expect(initials("New_ Public")).toBe("NP");
    expect(initials("internetarchive")).toBe("IN");
    expect(initials("W3C")).toBe("W3");
    expect(initials("  ")).toBe("?");
  });

  it("says relative time in words", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(relativeTime("2026-10-21T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-10-21T11:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-10-21T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-10-20T10:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("2026-10-07T12:00:00Z", now)).toBe("2 weeks ago");
    expect(relativeTime("2026-10-23T12:00:00Z", now)).toBe("in 2 days");
    expect(relativeTime("garbage", now)).toBe("");
  });

  it("formats durations per kind", () => {
    expect(formatDuration(2280, "podcast")).toBe("38 min");
    expect(formatDuration(372, "video")).toBe("6:12");
    expect(formatDuration(3900, "podcast")).toBe("1 h 5 min");
    expect(formatDuration(7200, "video")).toBe("2 h");
    expect(formatDuration(undefined, "video")).toBeUndefined();
    expect(formatDuration(0, "video")).toBeUndefined();
  });

  it("formats event dates and civic deadlines, and ignores bad ones", () => {
    const event = eventDate("2026-10-26T15:00:00Z");
    expect(event?.dateTime).toBe("2026-10-26T15:00:00.000Z");
    expect(event?.label).toMatch(/Oct/);
    expect(eventDate("nope")).toBeUndefined();
    expect(deadlineLabel("2026-10-28T12:00:00Z")).toMatch(/^Open until Oct 2[78]$/);
    expect(deadlineLabel(undefined)).toBeUndefined();
  });

  it("maps a civic item's process type to the hub's color key", () => {
    expect(processKey({ processType: "civic.vote" })).toBe("vote");
    expect(processKey({ processType: "civic.polis_deliberation" })).toBe("conversation");
    expect(processKey({ processType: "civic.meeting_summary" })).toBe("meeting");
    expect(processKey({ processType: "civic.brief" })).toBe("brief");
    expect(processKey({ processType: "civic.wordcloud" })).toBe("wordcloud");
    // Without a processType, the object names the process; the processType wins when both do.
    expect(processKey({ objectType: "hub:Project" })).toBe("project");
    expect(processKey({ objectType: "civic:Proposal" })).toBe("proposal");
    expect(processKey({ processType: "civic.vote", objectType: "civic:Proposal" })).toBe("vote");
    expect(processKey({ processType: "civic.unknown", objectType: "civic:Process" })).toBeUndefined();
    expect(processKey(null)).toBeUndefined();
  });

  it("passes only hex circle colors into CSS", () => {
    expect(circleColor("#2F6FA8")).toBe("#2F6FA8");
    expect(circleColor("red; background: url(x)")).toBeUndefined();
    expect(circleColor(null)).toBeUndefined();
  });
});

describe("feed query string", () => {
  it("leaves out empty values, and encodes the rest", () => {
    expect(feedSearch({ circles: [], types: [], networks: [], q: "  " })).toBe("");
    expect(feedSearch({ circles: ["News and ideas"], types: ["podcasts"], q: " budget ", cursor: "abc" })).toBe(
      "?circle=News+and+ideas&type=podcasts&q=budget&cursor=abc",
    );
    // One circle parameter per circle (ui-revisions-4 item 1), so a name may hold a comma.
    expect(feedSearch({ circles: ["Family", "News, ideas"] })).toBe("?circle=Family&circle=News%2C+ideas");
    expect(feedSearch({ types: ["posts", "videos"], networks: ["hubs", "fediverse"] })).toBe(
      "?type=posts%2Cvideos&network=hubs%2Cfediverse",
    );
  });
});
