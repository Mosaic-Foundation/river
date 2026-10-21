// Modes (spec F9, 4.7; decisions log row 23): a mode is a way of using the River. It sets the
// feed's scope, the theme, and which plugins appear on which surface. v1's modes are built-in
// definitions in code; `instances.modes_enabled` says which an instance offers and
// `instances.default_mode` which opens first (spec 3.1: "Modes are configuration in v1").
// People making their own modes comes later (spec 5); a new mode is one more entry here.
import type { Surface } from "../plugins/api.js";

export const MODES = ["everything", "civic"] as const;
export type Mode = (typeof MODES)[number];

export interface ModeDefinition {
  id: Mode;
  title: string;
  /** The theme the River wears in this mode (ui/src/styles/themes/). */
  theme: "mosaic" | "civic";
  /**
   * Which followed spaces the mode shows: every one, or civic-category spaces plus the members
   * of the reader's `role = civic` circle (found by role, never by name: renaming keeps it).
   */
  scope: "all" | "civic";
  /** Plugin ids per surface, in display order. */
  surfaces: Partial<Record<Surface, readonly string[]>>;
  /**
   * What the mode's plugins read: the current view (filters applied) or everything the mode
   * follows, whatever the circle, types, networks or search (ui-revisions-1 item 6).
   */
  pluginReach: "view" | "followed";
}

export const MODE_DEFINITIONS: Readonly<Record<Mode, ModeDefinition>> = {
  everything: {
    id: "everything",
    title: "Everything",
    theme: "mosaic",
    scope: "all",
    // A right-hand "Coming up" column across all followed sources (ui-revisions-1 item 6).
    surfaces: { "river.panel": ["coming-up"] },
    pluginReach: "followed",
  },
  civic: {
    id: "civic",
    title: "Civic",
    theme: "civic",
    scope: "civic",
    surfaces: { "river.panel": ["coming-up", "your-representatives", "elections-and-ballot"] },
    pluginReach: "view",
  },
};

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

/** An instance's modes in its own order, keeping only those the code defines. */
export function enabledModes(modesEnabled: readonly string[]): ModeDefinition[] {
  const seen = new Set<string>();
  const out: ModeDefinition[] = [];
  for (const raw of modesEnabled) {
    const id = raw.toLowerCase();
    if (isMode(id) && !seen.has(id)) {
      seen.add(id);
      out.push(MODE_DEFINITIONS[id]);
    }
  }
  return out;
}
