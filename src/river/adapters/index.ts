// The adapters the River can follow and refresh (spec 4.1). Order matters for what is typed in the
// follow box: the Civic Hub adapter is tried first for URLs, a fediverse profile URL
// (https://server/@name) falls to the fediverse adapter (the hub adapter doesn't accept it), and
// the feed adapter (RSS, Atom, podcasts; M12) comes last because it takes any https URL.
// Sample spaces (adapter "sample") are seeded by migration and never fetched, so they have no
// entry here; rep_space_v01 and atproto are stubs for later milestones.
import {
  AdapterError,
  ADAPTER_MESSAGES,
  type Adapter,
  type AdapterName,
  type FetchContext,
  type SpacePreview,
} from "../../shared/items/index.js";
import { civicHubAdapter } from "./civicHub/index.js";
import { fediverseAdapter } from "./fediverse/index.js";
import { rssAdapter } from "./rss/index.js";

export const ADAPTER_REGISTRY: readonly Adapter[] = [civicHubAdapter, fediverseAdapter, rssAdapter];

/** The adapter that refreshes a stored space, or undefined (samples, stubs). */
export function adapterNamed(name: AdapterName | string): Adapter | undefined {
  return ADAPTER_REGISTRY.find((adapter) => adapter.name === name);
}

/** The first adapter that takes what was typed in the follow box (or a seed follow's url). */
export function adapterFor(input: string): Adapter | undefined {
  return ADAPTER_REGISTRY.find((adapter) => adapter.accepts(input));
}

/** Every adapter that takes the input, in registry order. */
export function adaptersFor(input: string, registry: readonly Adapter[] = ADAPTER_REGISTRY): Adapter[] {
  return registry.filter((adapter) => adapter.accepts(input));
}

/**
 * Resolves the input with the first candidate that recognizes it. "That address isn't a Space we
 * can follow" from one adapter passes the input to the next; any other failure is the answer,
 * except that a later adapter's "couldn't reach" doesn't hide an earlier adapter's answer that the
 * address was reached and isn't a Space (the feed adapter, last, takes any URL).
 */
export async function resolveWith(
  candidates: readonly Adapter[],
  input: string,
  ctx: Pick<FetchContext, "guard" | "now">,
): Promise<SpacePreview> {
  const notASpace = new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  let reachedBefore = false;
  for (const [index, adapter] of candidates.entries()) {
    try {
      return await adapter.resolve(input, ctx);
    } catch (err) {
      const last = index === candidates.length - 1;
      const reason = err instanceof AdapterError ? err.reason : "unreachable";
      if (reason === "not_a_space") {
        if (last) throw err;
        reachedBefore = true;
        continue;
      }
      if (reason === "unreachable" && reachedBefore) throw notASpace;
      throw err instanceof AdapterError ? err : new AdapterError("unreachable", ADAPTER_MESSAGES.unreachable);
    }
  }
  throw notASpace;
}

export { civicHubAdapter, fediverseAdapter, rssAdapter };
