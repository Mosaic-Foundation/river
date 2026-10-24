import { describe, expect, it } from "vitest";
import { resolveScheme, savedScheme, SCHEME_KEY } from "../../../ui/src/lib/colorScheme";

// Light or dark (docs/spec/ui-revisions-9.md item 2): the choice saved in Settings wins; without
// one, the device's setting decides.
function store(value: string | null) {
  return { getItem: (key: string) => (key === SCHEME_KEY ? value : null) };
}

describe("savedScheme", () => {
  it("reads light or dark, and nothing else", () => {
    expect(savedScheme(store("dark"))).toBe("dark");
    expect(savedScheme(store("light"))).toBe("light");
    expect(savedScheme(store("purple"))).toBeNull();
    expect(savedScheme(store(null))).toBeNull();
    expect(savedScheme(null)).toBeNull();
  });

  it("treats blocked storage as no choice", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(savedScheme(blocked)).toBeNull();
  });
});

describe("resolveScheme", () => {
  it("prefers the saved choice, else the device's setting", () => {
    expect(resolveScheme("light", true)).toBe("light");
    expect(resolveScheme("dark", false)).toBe("dark");
    expect(resolveScheme(null, true)).toBe("dark");
    expect(resolveScheme(null, false)).toBe("light");
  });
});
