// The light/dark scheme as React state (docs/spec/ui-revisions-9.md item 2): the saved choice,
// else the device's, applied to <html> and followed as the device changes until a choice is made.
import { useEffect, useState } from "react";
import { resolveScheme, savedScheme, SCHEME_KEY, type ColorScheme } from "../lib/colorScheme";

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
