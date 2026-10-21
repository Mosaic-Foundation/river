import { describe, expect, it } from "vitest";
import { ADAPTER_REGISTRY, adapterFor, adapterNamed } from "../../src/river/adapters/index.js";

describe("adapter registry", () => {
  it("lists the hub adapter before the fediverse adapter", () => {
    expect(ADAPTER_REGISTRY.map((a) => a.name)).toEqual(["civic_hub", "fediverse"]);
  });

  it.each([
    ["https://demosville.civic.social", "civic_hub"],
    ["https://longmont.civic.social/meeting-summary/proc_61d1410393c7427e", "civic_hub"],
    ["floyd.civic.social", "civic_hub"],
    ["@w3c@w3c.social", "fediverse"],
    ["https://mastodon.social/@eff", "fediverse"],
  ])("routes %s to %s", (input, name) => {
    expect(adapterFor(input)?.name).toBe(name);
  });

  it("has no adapter for samples or an email-shaped name", () => {
    expect(adapterFor("urn:mosaic:sample:soccer-club")).toBeUndefined();
    expect(adapterFor("someone@example.org")).toBeUndefined();
    expect(adapterNamed("sample")).toBeUndefined();
    expect(adapterNamed("fediverse")?.name).toBe("fediverse");
  });
});
