// Modes and plugins (spec F9, 4.7; checks 7 and 8, logic part): the manifest, the registry, what
// a plugin may read, Coming up, the placeholders, and the modes' definitions. No database.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Instance } from "../../src/river/instances.js";
import { enabledModes, MODE_DEFINITIONS, MODES } from "../../src/river/modes/index.js";
import { parseMode, scopeFor, type ReaderView } from "../../src/river/feed/visitor.js";
import { FeedInputError } from "../../src/river/feed/query.js";
import type { PluginItem, ViewApi, ViewPlugin } from "../../src/river/plugins/api.js";
import { COMING_UP_LIMIT, comingUp, comingUpPlugin } from "../../src/river/plugins/builtin/comingUp.js";
import { electionsPlugin, representativesPlugin } from "../../src/river/plugins/builtin/placeholders.js";
import { ManifestError, validateManifest } from "../../src/river/plugins/manifest.js";
import {
  BUILT_IN_PLUGINS,
  builtInRegistry,
  createRegistry,
  pluginEnabled,
  runSurface,
} from "../../src/river/plugins/registry.js";

const NOW = "2026-10-21T00:00:00.000Z";

let n = 0;
function item(patch: Partial<PluginItem> = {}): PluginItem {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    kind: "civic",
    publishedAt: "2026-10-20T00:00:00.000Z",
    title: `Item ${n}`,
    url: `https://demosville.civic.social/process/proc_${n}`,
    streamKey: `https://demosville.civic.social/process/proc_${n}`,
    deadline: null,
    eventStart: null,
    source: "live",
    space: { id: "hub", name: "Demosville Civic Hub", category: "civic" },
    ...patch,
  };
}

function api(items: PluginItem[]): ViewApi {
  return { items, now: NOW, reach: "view" };
}

const manifest = {
  id: "upcoming-events",
  kind: "view",
  version: "1.0.0",
  surfaces: ["river.panel"],
  title: "Upcoming events",
  capabilities: ["read:items"],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plugin manifest (spec 4.7)", () => {
  it("accepts the spec's shape on every River surface, and freezes it", () => {
    for (const surface of ["river.panel", "river.mode-header", "river.card-action"]) {
      const checked = validateManifest({ ...manifest, surfaces: [surface] });
      expect(checked).toEqual({ ...manifest, surfaces: [surface] });
      expect(Object.isFrozen(checked)).toBe(true);
      expect(Object.isFrozen(checked.surfaces)).toBe(true);
    }
    expect(validateManifest({ ...manifest, capabilities: [] }).capabilities).toEqual([]);
  });

  it.each([
    ["not an object", "coming-up"],
    ["a kind other than view", { ...manifest, kind: "tool" }],
    ["an unknown surface", { ...manifest, surfaces: ["process-card"] }],
    ["no surface", { ...manifest, surfaces: [] }],
    ["a surface twice", { ...manifest, surfaces: ["river.panel", "river.panel"] }],
    ["an unknown capability", { ...manifest, capabilities: ["read:items", "write:follows"] }],
    ["a network capability", { ...manifest, capabilities: ["net:fetch"] }],
    ["a bad id", { ...manifest, id: "Coming Up" }],
    ["a bad version", { ...manifest, version: "1" }],
    ["an empty title", { ...manifest, title: " " }],
    ["an extra field", { ...manifest, entry: "https://plugins.example/coming-up.js" }],
  ])("refuses %s", (_label, value) => {
    expect(() => validateManifest(value)).toThrow(ManifestError);
  });
});

describe("plugin registry", () => {
  it("holds the three v1 plugins with valid manifests", () => {
    expect(builtInRegistry.manifests().map((m) => m.id)).toEqual(["coming-up", "your-representatives", "elections-and-ballot"]);
    for (const m of builtInRegistry.manifests()) {
      expect(validateManifest(m)).toEqual(m);
      expect(m.kind).toBe("view");
    }
    expect(builtInRegistry.get("coming-up")?.manifest.capabilities).toEqual(["read:items"]);
    // The placeholders read nothing, so they ask for nothing.
    expect(builtInRegistry.get("your-representatives")?.manifest.capabilities).toEqual([]);
  });

  it("refuses a repeated id or a bad manifest", () => {
    expect(() => createRegistry([comingUpPlugin, comingUpPlugin])).toThrow(/twice/);
    expect(() =>
      createRegistry([{ manifest: { ...comingUpPlugin.manifest, kind: "tool" } as never, render: () => null }]),
    ).toThrow(ManifestError);
  });

  it("every plugin a mode places exists and declares that surface", () => {
    for (const mode of MODES) {
      for (const [surface, ids] of Object.entries(MODE_DEFINITIONS[mode].surfaces)) {
        for (const id of ids ?? []) {
          const plugin = builtInRegistry.get(id);
          expect(plugin, `${mode} places ${id}`).toBeDefined();
          expect(plugin!.manifest.surfaces).toContain(surface);
        }
      }
    }
  });

  it("an instance can turn a plugin off; other entries change nothing", () => {
    expect(pluginEnabled([], "coming-up")).toBe(true);
    expect(pluginEnabled([{ id: "coming-up", enabled: false }], "coming-up")).toBe(false);
    expect(pluginEnabled([{ id: "coming-up", enabled: false }], "your-representatives")).toBe(true);
    expect(pluginEnabled(["coming-up", null, 3, { id: "coming-up" }], "coming-up")).toBe(true);
  });
});

describe("runSurface: what a plugin may read", () => {
  const now = new Date(NOW);

  it("runs a mode's plugins in order, leaving out unknown ids, other surfaces and turned-off plugins", () => {
    const items = [item({ deadline: "2026-11-08T05:00:47.238Z" })];
    const ids = ["coming-up", "nope", "your-representatives", "elections-and-ballot"];
    const out = runSurface(builtInRegistry, "river.panel", ids, { items, now });
    expect(out.map((o) => o.id)).toEqual(["coming-up", "your-representatives", "elections-and-ballot"]);
    expect(out.map((o) => o.title)).toEqual(["Coming up", "Your representatives", "Elections and ballot"]);
    expect(runSurface(builtInRegistry, "river.card-action", ids, { items, now })).toEqual([]);
    const off = runSurface(builtInRegistry, "river.panel", ids, { items, now, config: [{ id: "coming-up", enabled: false }] });
    expect(off.map((o) => o.id)).toEqual(["your-representatives", "elections-and-ballot"]);
  });

  it("gives items only to plugins that declare read:items, frozen", () => {
    const seen: Record<string, ViewApi> = {};
    const spy = (id: string, capabilities: Array<"read:items">): ViewPlugin => ({
      manifest: { id, kind: "view", version: "1.0.0", surfaces: ["river.panel"], title: id, capabilities },
      render: (a) => {
        seen[id] = a;
        return { type: "placeholder", text: id, waitingOn: [] };
      },
    });
    const registry = createRegistry([spy("reader", ["read:items"]), spy("blind", [])]);
    const items = [item()];
    runSurface(registry, "river.panel", ["reader", "blind"], { items, now });
    expect(seen.reader!.items).toHaveLength(1);
    expect(seen.reader!.items[0]).not.toBe(items[0]); // a copy
    expect(Object.isFrozen(seen.reader!.items)).toBe(true);
    expect(Object.isFrozen(seen.reader!.items[0]!.space)).toBe(true);
    expect(seen.blind!.items).toEqual([]);
    expect(Object.keys(seen.reader!).sort()).toEqual(["items", "now", "reach"]); // and nothing else
    expect(seen.reader!.reach).toBe("view");
    expect(seen.reader!.now).toBe(NOW);
  });

  it("leaves out a plugin that throws or changes its items, and keeps the rest", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const base = { kind: "view" as const, version: "1.0.0", surfaces: ["river.panel" as const], capabilities: ["read:items" as const] };
    const registry = createRegistry([
      { manifest: { ...base, id: "broken", title: "Broken" }, render: () => { throw new Error("boom"); } },
      {
        manifest: { ...base, id: "meddler", title: "Meddler" },
        render: (a) => {
          (a.items[0] as { title: string | null }).title = "changed";
          return null;
        },
      },
      comingUpPlugin,
    ]);
    const items = [item({ title: "Library vote", deadline: "2026-10-28T00:00:00.000Z" })];
    const out = runSurface(registry, "river.panel", ["broken", "meddler", "coming-up"], { items, now });
    expect(out.map((o) => o.id)).toEqual(["coming-up"]);
    expect(items[0]!.title).toBe("Library vote");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"broken"'));
  });
});

describe("Coming up (spec 4.7)", () => {
  it("says where its dates come from: the view, or everything followed (ui-revisions-1 item 6)", () => {
    const soon = item({ id: "e", kind: "event", eventStart: "2026-10-25T18:00:00.000Z" });
    const inView = comingUpPlugin.render(api([soon]));
    const followed = comingUpPlugin.render({ ...api([soon]), reach: "followed" });
    expect(inView).toMatchObject({ type: "dates", intro: "Dates from the items in this view." });
    expect(followed).toMatchObject({ type: "dates", intro: "Dates from everything you follow." });
  });

  it("Everything places Coming up on everything followed; Civic on the view", () => {
    expect(MODE_DEFINITIONS.everything.surfaces["river.panel"]).toEqual(["coming-up"]);
    expect(MODE_DEFINITIONS.everything.pluginReach).toBe("followed");
    expect(MODE_DEFINITIONS.civic.pluginReach).toBe("view");
  });

  it("lists upcoming deadlines and event starts in date order, at most five", () => {
    const items = [
      item({ title: "Parks vote", deadline: "2026-11-08T05:00:47.238Z" }),
      item({ title: "Library vote", deadline: "2026-10-28T00:00:00.000Z" }),
      item({ kind: "event", title: "Cleanup day", eventStart: "2026-10-26T15:00:00.000Z", source: "sample", url: null, streamKey: null, space: { id: "s", name: "Elm Street Neighbors", category: "neighborhood" } }),
      item({ title: "Budget vote", deadline: "2026-12-01T00:00:00.000Z" }),
      item({ title: "Transit vote", deadline: "2026-11-15T00:00:00.000Z" }),
      item({ title: "Water vote", deadline: "2026-11-20T00:00:00.000Z" }),
      item({ title: "Late vote", deadline: "2027-01-01T00:00:00.000Z" }),
    ];
    const entries = comingUp(api(items));
    expect(entries.map((e) => e.title)).toEqual(["Cleanup day", "Library vote", "Parks vote", "Transit vote", "Water vote"]);
    expect(entries).toHaveLength(COMING_UP_LIMIT);
    expect(entries.map((e) => e.date)).toEqual([...entries.map((e) => e.date)].sort());
    expect(entries[0]).toMatchObject({ what: "event", spaceName: "Elm Street Neighbors", url: null, source: "sample" });
    expect(entries[1]).toMatchObject({ what: "deadline", spaceName: "Demosville Civic Hub", date: "2026-10-28T00:00:00.000Z" });
  });

  it("leaves out past dates, bad dates, and start times of anything but events", () => {
    const items = [
      item({ deadline: "2026-10-20T23:59:59.000Z" }),
      item({ deadline: "not a date" }),
      item({ kind: "post", eventStart: "2026-10-30T00:00:00.000Z" }),
      item({ kind: "event", eventStart: "2026-10-01T00:00:00.000Z" }),
    ];
    expect(comingUp(api(items))).toEqual([]);
    expect(comingUpPlugin.render(api(items))).toBeNull(); // hidden when there are none
    expect(comingUpPlugin.render(api([]))).toBeNull();
  });

  it("shows a process's deadline once, from its newest item", () => {
    const stream = "https://longmont.civic.social/process/proc_61d1410393c7427e";
    const items = [
      item({ title: "Voting opened", streamKey: stream, deadline: "2026-11-08T05:00:47.238Z" }),
      item({ title: "Process opened", streamKey: stream, deadline: "2026-11-08T05:00:47.238Z" }),
    ];
    const entries = comingUp(api(items));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe("Voting opened");
  });

  it("falls back to the space's name for an untitled item", () => {
    expect(comingUp(api([item({ title: null, deadline: "2026-11-01T00:00:00.000Z" })]))[0]!.title).toBe("Demosville Civic Hub");
  });
});

describe("the placeholder slots (spec F9)", () => {
  it("name the data sources they wait on", () => {
    expect(representativesPlugin.render(api([]))).toEqual({
      type: "placeholder",
      text: "Who represents you at each level, and how to reach them.",
      waitingOn: ["Open States", "Geocodio", "Cicero"],
    });
    expect(electionsPlugin.render(api([]))).toEqual({
      type: "placeholder",
      text: "Upcoming elections and what is on your ballot.",
      waitingOn: ["Democracy Works", "Ballotpedia"],
    });
    expect(BUILT_IN_PLUGINS).toContain(representativesPlugin);
  });
});

describe("modes (spec F9, 4.7)", () => {
  it("Everything: all follows, Mosaic, no panel. Civic: civic scope, Civic theme, the panel", () => {
    expect(MODE_DEFINITIONS.everything).toMatchObject({ theme: "mosaic", scope: "all", surfaces: {} });
    expect(MODE_DEFINITIONS.civic).toMatchObject({
      theme: "civic",
      scope: "civic",
      surfaces: { "river.panel": ["coming-up", "your-representatives", "elections-and-ballot"] },
    });
  });

  it("an instance's modes keep its order and drop unknown ones", () => {
    expect(enabledModes(["civic", "everything"]).map((m) => m.id)).toEqual(["civic", "everything"]);
    expect(enabledModes(["civic", "party", "CIVIC"]).map((m) => m.id)).toEqual(["civic"]);
  });

  it("check 8 (logic): a civic-only instance opens in Civic and refuses Everything", () => {
    const civicOnly = { modesEnabled: ["civic"], defaultMode: "civic" } as Instance;
    expect(parseMode(undefined, civicOnly)).toBe("civic");
    expect(parseMode("Civic", civicOnly)).toBe("civic");
    expect(() => parseMode("everything", civicOnly)).toThrow(FeedInputError);
  });

  it("civic mode finds the civic circle by role, not by name", () => {
    const view: ReaderView = {
      follows: [{ spaceId: "hub" }, { spaceId: "w3c" }, { spaceId: "family" }],
      circles: [
        { id: "c1", name: "Civic", color: null, role: null, spaceIds: ["family"] },
        { id: "c2", name: "Our town", color: null, role: "civic", spaceIds: ["w3c"] },
      ],
      categories: new Map([
        ["hub", "civic"],
        ["w3c", "organization"],
        ["family", "family"],
      ]),
    };
    expect(scopeFor(view, "civic", undefined).spaceIds).toEqual(["hub", "w3c"]);
    expect(scopeFor(view, "everything", undefined).spaceIds).toEqual(["hub", "w3c", "family"]);
  });
});
