// Light or dark (docs/spec/ui-revisions-9.md item 2). The scheme lives on <html> as
// data-scheme="light" | "dark"; the themes (mosaic.css, civic.css) redefine their tokens for dark.
// The choice made in Settings is saved in this browser; until there is one, the device's setting
// decides and changes with it. public/color-scheme.js applies the same rule before first paint;
// components/useColorScheme.ts keeps it current. No React here: unit tests import this file from
// the root package, which has no React.
export type ColorScheme = "light" | "dark";

export const SCHEME_KEY = "river:color-scheme";

/** The saved choice, if any (storage can be blocked: then none). */
export function savedScheme(storage: Pick<Storage, "getItem"> | null): ColorScheme | null {
  try {
    const value = storage?.getItem(SCHEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** The saved choice, else the device's. */
export function resolveScheme(saved: ColorScheme | null, deviceDark: boolean): ColorScheme {
  return saved ?? (deviceDark ? "dark" : "light");
}
