// The feed's filter state, and "Clear all" (ui-revisions-3 item 5, ui-revisions-4 item 4): the
// filters it resets, and whether any of them is on. The mode is the header's, not a filter, so it
// stays.

export interface FilterState {
  /** The mode (spec F9): "" for the instance's default. Set by the header's switch, not here. */
  mode: string;
  /** Circle ids, any of them (ui-revisions-4 item 1); empty for All. */
  circles: string[];
  /** Content-type values (CONTENT_TYPES); empty for All. */
  types: string[];
  /** Network values (NETWORKS); empty for every network. */
  networks: string[];
  q: string;
}

export const CLEARED: Pick<FilterState, "circles" | "types" | "networks" | "q"> = { circles: [], types: [], networks: [], q: "" };

export function hasActiveFilter(value: FilterState): boolean {
  return value.circles.length > 0 || value.types.length > 0 || value.networks.length > 0 || value.q !== "";
}

/** Turns a circle on or off, keeping the order the circles are listed in (unknown ids last). */
export function toggleCircle(selected: readonly string[], id: string, circles: ReadonlyArray<{ id: string }>): string[] {
  const next = selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id];
  const rank = (c: string) => {
    const at = circles.findIndex((k) => k.id === c);
    return at === -1 ? circles.length : at;
  };
  return [...next].sort((a, b) => rank(a) - rank(b));
}
