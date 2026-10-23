import { describe, expect, it } from "vitest";
import { CLEARED, hasActiveFilter, toggleCircle, type FilterState } from "../../../ui/src/lib/filters";

// ui-revisions-3 item 5: "Clear all" shows when search, a circle, a type or a network is on, and
// resets those four, never the mode.
const none: FilterState = { mode: "civic", circles: [], types: [], networks: [], q: "" };

describe("hasActiveFilter", () => {
  it("is false with nothing on, whatever the mode", () => {
    expect(hasActiveFilter(none)).toBe(false);
  });

  it("is true for each of search, circle, type and network", () => {
    expect(hasActiveFilter({ ...none, q: "vote" })).toBe(true);
    expect(hasActiveFilter({ ...none, circles: ["c1"] })).toBe(true);
    expect(hasActiveFilter({ ...none, types: ["posts"] })).toBe(true);
    expect(hasActiveFilter({ ...none, networks: ["hubs"] })).toBe(true);
  });

  it("CLEARED resets those four and leaves the mode alone", () => {
    const busy: FilterState = { ...none, circles: ["c1", "c2"], types: ["posts"], networks: ["hubs"], q: "x" };
    const cleared = { ...busy, ...CLEARED };
    expect(cleared).toEqual(none);
    expect(Object.keys(CLEARED)).not.toContain("mode");
  });
});

// ui-revisions-4 item 1: circles toggle, several at once, kept in the order they are listed.
describe("toggleCircle", () => {
  const circles = [{ id: "Civic" }, { id: "News and ideas" }, { id: "Family" }];

  it("adds a circle that is off and removes one that is on", () => {
    expect(toggleCircle([], "Family", circles)).toEqual(["Family"]);
    expect(toggleCircle(["Family"], "Civic", circles)).toEqual(["Civic", "Family"]);
    expect(toggleCircle(["Civic", "Family"], "Civic", circles)).toEqual(["Family"]);
    expect(toggleCircle(["Family"], "Family", circles)).toEqual([]);
  });

  it("keeps the list's order, with circles it doesn't list last", () => {
    expect(toggleCircle(["Gone", "Family"], "News and ideas", circles)).toEqual(["News and ideas", "Family", "Gone"]);
  });
});
