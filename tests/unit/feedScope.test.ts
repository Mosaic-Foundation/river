// The feed's filters before any query: content types, cursors, modes, circles and the civic scope
// (spec F5, F9), and how hostnames and followed names are read. No database.
import { afterEach, describe, expect, it } from "vitest";
import type { Instance } from "../../src/river/instances.js";
import { isSeedAlias, normalizeHost } from "../../src/river/instances.js";
import { decodeCursor, encodeCursor, FeedInputError, parseContentType } from "../../src/river/feed/query.js";
import { spaceKeyFor, type SpaceRow } from "../../src/river/feed/spaces.js";
import { parseMode, scopeFor, visitorView } from "../../src/river/feed/visitor.js";

const instance: Instance = {
  id: "00000000-0000-4000-8000-000000000001",
  hostname: "river.mosaic.social",
  name: "Mosaic River",
  theme: "mosaic",
  modesEnabled: ["everything", "civic"],
  defaultMode: "everything",
  seedFollows: [
    { url: "https://demosville.civic.social", circles: ["Civic"] },
    { url: "@w3c@w3c.social", circles: ["News and ideas"] },
    { url: "urn:mosaic:sample:small-town-signals", circles: ["News and ideas"] },
    { url: "urn:mosaic:sample:okafor-family", circles: ["Family"] },
    { url: "urn:mosaic:sample:trailhead-tv", circles: [] },
    { url: "https://longmont.civic.social", stream_key: "https://longmont.civic.social/process/proc_1", circles: [] },
  ],
  defaultCircles: [
    { name: "Civic", color: "#2F6FA8", role: "civic", members: ["https://demosville.civic.social"] },
    { name: "News and ideas", color: "#7A5AA6", members: ["@w3c@w3c.social", "urn:mosaic:sample:small-town-signals"] },
    { name: "Family", color: "#C2603A", members: ["urn:mosaic:sample:okafor-family", "urn:mosaic:sample:trailhead-tv"] },
  ],
  plugins: [],
};

function space(id: string, category: SpaceRow["category"], adapter: SpaceRow["adapter"] = "sample"): SpaceRow {
  return { id, category, adapter } as SpaceRow;
}

const spaces = new Map<string, SpaceRow>([
  ["https://demosville.civic.social", space("hub", "civic", "civic_hub")],
  ["@w3c@w3c.social", space("w3c", "organization", "fediverse")],
  ["urn:mosaic:sample:small-town-signals", space("podcast", "podcast")],
  ["urn:mosaic:sample:okafor-family", space("family", "family")],
  ["urn:mosaic:sample:trailhead-tv", space("video", "video")],
  ["https://longmont.civic.social", space("longmont", "civic", "civic_hub")],
]);

describe("content types (spec F5)", () => {
  it.each([
    [undefined, undefined],
    ["all", undefined],
    ["Podcasts", "podcast"],
    ["podcast", "podcast"],
    ["photos", "photo"],
    ["civic", "civic"],
    ["events", "event"],
  ])("%s is %s", (raw, kind) => {
    expect(parseContentType(raw)).toBe(kind);
  });

  it("refuses an unknown type", () => {
    expect(() => parseContentType("memes")).toThrow(FeedInputError);
  });
});

describe("cursors", () => {
  it("round-trip Postgres's timestamp text and the item id", () => {
    const cursor = { at: "2026-10-20 23:24:40.683266+00", id: "11111111-1111-4111-8111-111111111111" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("refuse anything else", () => {
    expect(() => decodeCursor("nonsense")).toThrow(FeedInputError);
    expect(() => decodeCursor(Buffer.from('["2026-01-01", "x\'; --"]').toString("base64url"))).toThrow(FeedInputError);
  });
});

describe("visitor scope", () => {
  const view = visitorView(instance, spaces);

  it("follows every seed follow that has a space, a stream follow as a stream", () => {
    expect(scopeFor(view, "everything", undefined)).toEqual({
      spaceIds: ["hub", "w3c", "podcast", "family", "video"],
      streams: [{ spaceId: "longmont", key: "https://longmont.civic.social/process/proc_1" }],
    });
  });

  it("circles come from default_circles, named by name", () => {
    expect(view.circles.map((c) => [c.id, c.role, c.spaceIds])).toEqual([
      ["Civic", "civic", ["hub"]],
      ["News and ideas", null, ["w3c", "podcast"]],
      ["Family", null, ["family", "video"]],
    ]);
  });

  it("a circle narrows to its members", () => {
    expect(scopeFor(view, "everything", "News and ideas")).toEqual({ spaceIds: ["w3c", "podcast"], streams: [] });
    expect(scopeFor(view, "everything", "All").spaceIds).toHaveLength(5);
    expect(() => scopeFor(view, "everything", "Bowling")).toThrow(FeedInputError);
  });

  it("civic mode keeps civic-category spaces and the civic-role circle (spec F9)", () => {
    expect(scopeFor(view, "civic", undefined)).toEqual({
      spaceIds: ["hub"],
      streams: [{ spaceId: "longmont", key: "https://longmont.civic.social/process/proc_1" }],
    });
    // circle AND mode
    expect(scopeFor(view, "civic", "Family")).toEqual({ spaceIds: [], streams: [] });
  });

  it("modes must be enabled on the instance", () => {
    expect(parseMode(undefined, instance)).toBe("everything");
    expect(parseMode("civic", instance)).toBe("civic");
    expect(() => parseMode("civic", { ...instance, modesEnabled: ["everything"] })).toThrow(FeedInputError);
    expect(() => parseMode("party", instance)).toThrow(FeedInputError);
  });
});

describe("followed names to stored spaces", () => {
  it.each([
    ["urn:mosaic:sample:okafor-family", { by: "canonical", value: "urn:mosaic:sample:okafor-family" }],
    ["https://Demosville.civic.social", { by: "canonical", value: "https://demosville.civic.social" }],
    ["floyd.civic.social/process/proc_1", { by: "canonical", value: "https://floyd.civic.social" }],
    ["@W3C@w3c.social", { by: "handle", value: "@w3c@w3c.social" }],
    ["https://mastodon.social/@eff", { by: "profile", value: "https://mastodon.social/@eff" }],
  ])("%s", (input, key) => {
    expect(spaceKeyFor(input)).toEqual(key);
  });
});

describe("hostnames (check 26)", () => {
  const saved = { aliases: process.env.INSTANCE_HOST_ALIASES, vercelEnv: process.env.VERCEL_ENV };
  afterEach(() => {
    for (const [name, value] of [
      ["INSTANCE_HOST_ALIASES", saved.aliases],
      ["VERCEL_ENV", saved.vercelEnv],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("normalizes case, port and a trailing dot, and refuses junk", () => {
    expect(normalizeHost("River.Mosaic.Social:443")).toBe("river.mosaic.social");
    expect(normalizeHost("localhost.")).toBe("localhost");
    expect(normalizeHost("[::1]:3000")).toBe("[::1]");
    expect(normalizeHost("evil host")).toBeUndefined();
    expect(normalizeHost(undefined)).toBeUndefined();
  });

  it("aliases and previews get the seed instance; other hosts don't", () => {
    process.env.INSTANCE_HOST_ALIASES = "localhost,river-preview.vercel.app";
    delete process.env.VERCEL_ENV;
    expect(isSeedAlias("localhost")).toBe(true);
    expect(isSeedAlias("river-preview.vercel.app")).toBe(true);
    expect(isSeedAlias("elsewhere.example")).toBe(false);
    process.env.VERCEL_ENV = "preview";
    expect(isSeedAlias("elsewhere.example")).toBe(true);
    process.env.VERCEL_ENV = "production";
    expect(isSeedAlias("elsewhere.example")).toBe(false);
  });
});
