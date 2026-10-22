import { describe, expect, it } from "vitest";
import { CLEARED, hasActiveFilter, type FilterState } from "../../../ui/src/lib/filters";

// ui-revisions-3 item 5: "Clear all" shows when search, a circle, a type or a network is on, and
// resets those four, never the mode.
const none: FilterState = { mode: "civic", circle: "All", types: [], networks: [], q: "" };

describe("hasActiveFilter", () => {
  it("is false with nothing on, whatever the mode", () => {
    expect(hasActiveFilter(none)).toBe(false);
  });

  it("is true for each of search, circle, type and network", () => {
    expect(hasActiveFilter({ ...none, q: "vote" })).toBe(true);
    expect(hasActiveFilter({ ...none, circle: "c1" })).toBe(true);
    expect(hasActiveFilter({ ...none, types: ["posts"] })).toBe(true);
    expect(hasActiveFilter({ ...none, networks: ["hubs"] })).toBe(true);
  });

  it("CLEARED resets those four and leaves the mode alone", () => {
    const busy: FilterState = { ...none, circle: "c1", types: ["posts"], networks: ["hubs"], q: "x" };
    const cleared = { ...busy, ...CLEARED };
    expect(cleared).toEqual(none);
    expect(Object.keys(CLEARED)).not.toContain("mode");
  });
});
