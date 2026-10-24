// Light or dark (docs/spec/ui-revisions-9.md item 2). The scheme lives on <html> as
// data-scheme="light" | "dark"; the themes (mosaic.css, civic.css) redefine their tokens for dark.
// The choice made in Settings is saved in this browser; until there is one, the device's setting
// decides and changes with it. public/color-scheme.js applies the same rule before first paint.
import { useEffect, useState } from "react";

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

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function deviceQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
}

function apply(scheme: ColorScheme): void {
  document.documentElement.dataset.scheme = scheme;
}

/** The current scheme and a setter that saves the choice; follows the device until one is made. */
export function useColorScheme(): [ColorScheme, (scheme: ColorScheme) => void] {
  const [scheme, setScheme] = useState<ColorScheme>(() =>
    resolveScheme(savedScheme(storage()), deviceQuery()?.matches ?? false),
  );

  useEffect(() => apply(scheme), [scheme]);

  // No choice saved: follow the device as it changes (an evening switch to dark, say).
  useEffect(() => {
    const query = deviceQuery();
    if (!query) return;
    const onChange = () => {
      if (!savedScheme(storage())) setScheme(query.matches ? "dark" : "light");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const choose = (next: ColorScheme) => {
    try {
      storage()?.setItem(SCHEME_KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    setScheme(next);
  };

  return [scheme, choose];
}
