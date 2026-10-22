// The feed's filter state, and "Clear all" (ui-revisions-1 item 3, ui-revisions-3 item 5): the
// filters it resets, and whether any of them is on. The mode is the header's, not a filter, so it
// stays.

export interface FilterState {
  /** The mode (spec F9): "" for the instance's default. Set by the header's switch, not here. */
  mode: string;
  circle: string;
  /** Content-type values (CONTENT_TYPES); empty for All. */
  types: string[];
  /** Network values (NETWORKS); empty for every network. */
  networks: string[];
  q: string;
}

export const CLEARED: Pick<FilterState, "circle" | "types" | "networks" | "q"> = { circle: "All", types: [], networks: [], q: "" };

export function hasActiveFilter(value: FilterState): boolean {
  return value.circle !== "All" || value.types.length > 0 || value.networks.length > 0 || value.q !== "";
}
