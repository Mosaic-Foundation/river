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
  /** One source, a space id (ui-revisions-11 item 2); "" for every source. */
  source: string;
}

export const CLEARED: Pick<FilterState, "circles" | "types" | "networks" | "q" | "source"> = {
  circles: [],
  types: [],
  networks: [],
  q: "",
  source: "",
};

export function hasActiveFilter(value: FilterState): boolean {
  return (
    value.circles.length > 0 || value.types.length > 0 || value.networks.length > 0 || value.q !== "" || value.source !== ""
  );
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

/** How many filters are on: each circle, type and network, the search and the source (ui-revisions-6 item 1). */
export function activeFilterCount(value: FilterState): number {
  return value.circles.length + value.types.length + value.networks.length + (value.q ? 1 : 0) + (value.source ? 1 : 0);
}

/**
 * What's on, in a few words, for the phone's filter button: circles, then types, then networks,
 * then the source, then the search, e.g. "Family, News and ideas · Articles". Empty with nothing on.
 */
export function filterSummary(
  value: FilterState,
  circles: ReadonlyArray<{ id: string; name: string }>,
  labels: { types: ReadonlyArray<{ value: string; label: string }>; networks: ReadonlyArray<{ value: string; label: string }> },
  sources: ReadonlyArray<{ id: string; name: string }> = [],
): string {
  const named = (list: readonly string[], known: ReadonlyArray<{ value: string; label: string }>) =>
    known.filter((k) => list.includes(k.value)).map((k) => k.label);
  const groups = [
    value.circles.map((id) => circles.find((c) => c.id === id)?.name ?? id),
    named(value.types, labels.types),
    named(value.networks, labels.networks),
    value.source ? [sources.find((s) => s.id === value.source)?.name ?? "One source"] : [],
    value.q ? [`“${value.q}”`] : [],
  ];
  return groups
    .filter((g) => g.length > 0)
    .map((g) => g.join(", "))
    .join(" · ");
}
