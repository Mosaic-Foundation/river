// The adapters the River can follow and refresh (spec 4.1). Order matters for what is typed in the
// follow box: the Civic Hub adapter is tried first for URLs, and a fediverse profile URL
// (https://server/@name) falls to the fediverse adapter (the hub adapter doesn't accept it).
// Sample spaces (adapter "sample") are seeded by migration and never fetched, so they have no
// entry here; rep_space_v01 and atproto are stubs for later milestones.
import type { Adapter, AdapterName } from "../../shared/items/index.js";
import { civicHubAdapter } from "./civicHub/index.js";
import { fediverseAdapter } from "./fediverse/index.js";

export const ADAPTER_REGISTRY: readonly Adapter[] = [civicHubAdapter, fediverseAdapter];

/** The adapter that refreshes a stored space, or undefined (samples, stubs). */
export function adapterNamed(name: AdapterName | string): Adapter | undefined {
  return ADAPTER_REGISTRY.find((adapter) => adapter.name === name);
}

/** The first adapter that takes what was typed in the follow box (or a seed follow's url). */
export function adapterFor(input: string): Adapter | undefined {
  return ADAPTER_REGISTRY.find((adapter) => adapter.accepts(input));
}

export { civicHubAdapter, fediverseAdapter };
