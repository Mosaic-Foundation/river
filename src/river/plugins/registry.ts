// The plugin registry (spec 4.7): first-party plugins bundled at build time, their manifests
// checked when the module loads. Modes place plugins on surfaces (src/river/modes/); the instance
// can turn one off (`instances.plugins`); runSurface() runs what's left for the current view.
//
// Each plugin gets a ViewApi and nothing else. Items go only to plugins that declare
// "read:items", as frozen copies, so a plugin can't change what the feed returns or another
// plugin sees. A plugin that throws is left out of the response and logged by id; the feed
// still answers.
import type { PluginItem, PluginManifest, PluginOutput, Surface, ViewApi, ViewPlugin } from "./api.js";
import { comingUpPlugin } from "./builtin/comingUp.js";
import { electionsPlugin, representativesPlugin } from "./builtin/placeholders.js";
import { validateManifest } from "./manifest.js";

export interface PluginRegistry {
  get(id: string): ViewPlugin | undefined;
  manifests(): PluginManifest[];
}

/** A registry of these plugins; throws on a bad manifest or a repeated id. */
export function createRegistry(plugins: readonly ViewPlugin[]): PluginRegistry {
  const byId = new Map<string, ViewPlugin>();
  for (const plugin of plugins) {
    const manifest = validateManifest(plugin.manifest);
    if (byId.has(manifest.id)) throw new Error(`Plugin "${manifest.id}" is registered twice`);
    if (typeof plugin.render !== "function") throw new Error(`Plugin "${manifest.id}" has no render function`);
    byId.set(manifest.id, Object.freeze({ manifest, render: plugin.render }));
  }
  return {
    get: (id) => byId.get(id),
    manifests: () => [...byId.values()].map((p) => p.manifest),
  };
}

/** Every first-party plugin in v1. */
export const BUILT_IN_PLUGINS: readonly ViewPlugin[] = [comingUpPlugin, representativesPlugin, electionsPlugin];

export const builtInRegistry: PluginRegistry = createRegistry(BUILT_IN_PLUGINS);

/**
 * Whether an instance runs a plugin. `instances.plugins` lists changes to the defaults:
 * `[{ "id": "coming-up", "enabled": false }]` turns Coming up off. An empty list (the seed
 * instance) runs every plugin its modes place. Entries of any other shape are ignored.
 */
export function pluginEnabled(config: readonly unknown[], id: string): boolean {
  for (const entry of config) {
    const e = entry as { id?: unknown; enabled?: unknown } | null;
    if (e && typeof e === "object" && e.id === id && e.enabled === false) return false;
  }
  return true;
}

/** One plugin's output on a surface, as the feed returns it. */
export interface SurfaceOutput {
  id: string;
  title: string;
  version: string;
  output: PluginOutput;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/**
 * Runs the plugins `ids` (a mode's placement, in order) on `surface` for the current view.
 * Skips ids the registry doesn't know, plugins whose manifest doesn't name the surface, plugins
 * the instance turned off, and plugins that return null or throw.
 */
export function runSurface(
  registry: PluginRegistry,
  surface: Surface,
  ids: readonly string[],
  view: { items: readonly PluginItem[]; now: Date; config?: readonly unknown[]; reach?: "view" | "followed" },
): SurfaceOutput[] {
  const outputs: SurfaceOutput[] = [];
  const items = deepFreeze(view.items.map((item) => structuredClone(item)));
  for (const id of ids) {
    const plugin = registry.get(id);
    if (!plugin || !plugin.manifest.surfaces.includes(surface)) continue;
    if (!pluginEnabled(view.config ?? [], id)) continue;
    const api: ViewApi = Object.freeze({
      items: plugin.manifest.capabilities.includes("read:items") ? items : Object.freeze([]),
      now: view.now.toISOString(),
      reach: view.reach ?? "view",
    });
    try {
      const output = plugin.render(api);
      if (output) {
        outputs.push({ id, title: plugin.manifest.title, version: plugin.manifest.version, output: structuredClone(output) });
      }
    } catch (err) {
      console.error(`River plugin "${id}" failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return outputs;
}
