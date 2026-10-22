import { describe, expect, it } from "vitest";
import { ADAPTER_REGISTRY, adapterFor, adapterNamed, adaptersFor } from "../../src/river/adapters/index.js";

describe("adapter registry", () => {
  it("lists the hub adapter, then the fediverse adapter, then the feed adapter (M12)", () => {
    expect(ADAPTER_REGISTRY.map((a) => a.name)).toEqual(["civic_hub", "fediverse", "rss"]);
  });

  it.each([
    ["https://demosville.civic.social", "civic_hub"],
    ["https://longmont.civic.social/meeting-summary/proc_61d1410393c7427e", "civic_hub"],
    ["floyd.civic.social", "civic_hub"],
    ["@w3c@w3c.social", "fediverse"],
    ["https://mastodon.social/@eff", "fediverse"],
    ["@trail_films@synthetic-tube.example", "fediverse"],
  ])("routes %s to %s", (input, name) => {
    expect(adapterFor(input)?.name).toBe(name);
  });

  it("offers a URL to every adapter that takes it, the feed adapter last", () => {
    expect(adaptersFor("https://synthetic-podcast.example/feed.xml").map((a) => a.name)).toEqual(["civic_hub", "rss"]);
    expect(adaptersFor("https://synthetic-tube.example/video-channels/trail_films").map((a) => a.name)).toEqual([
      "civic_hub",
      "fediverse",
      "rss",
    ]);
    // The feed adapter takes https URLs only: no bare hosts, handles or http.
    expect(adaptersFor("floyd.civic.social").map((a) => a.name)).toEqual(["civic_hub"]);
    expect(adaptersFor("@w3c@w3c.social").map((a) => a.name)).toEqual(["fediverse"]);
    expect(adapterNamed("rss")?.accepts("http://synthetic-podcast.example/feed.xml")).toBe(false);
  });

  it("has no adapter for samples or an email-shaped name", () => {
    expect(adapterFor("urn:mosaic:sample:soccer-club")).toBeUndefined();
    expect(adapterFor("someone@example.org")).toBeUndefined();
    expect(adapterNamed("sample")).toBeUndefined();
    expect(adapterNamed("fediverse")?.name).toBe("fediverse");
    expect(adapterNamed("rss")?.name).toBe("rss");
  });
});
