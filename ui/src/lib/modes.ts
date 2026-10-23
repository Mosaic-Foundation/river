// Modes and the plugin panel in the UI (spec F9, 4.7). The API says which modes the instance
// offers, the current mode's theme and what each plugin returned; this file only turns that into
// words and links. No React or DOM, so tests/unit/ui/ can import it.
import type { DateEntry, ModeOption, PluginOutput } from "./api";

/** Civic mode's title, shown in the top bar (ui-revisions-5 item 2). */
export const CIVIC_TITLE = "Citizen Dashboard";

/**
 * The view's title for the page's h1 and the window title: Civic mode is the Citizen Dashboard;
 * any other mode keeps its own title (ui-revisions-5).
 */
export function viewTitle(mode: string, modeTitle: string): string {
  return mode === "civic" ? CIVIC_TITLE : modeTitle;
}

/** The top bar's title: Civic mode only; Everything shows none (ui-revisions-5 item 2). */
export function topbarTitle(mode: string): string | null {
  return mode === "civic" ? CIVIC_TITLE : null;
}

/** The switch shows only when the instance offers more than one mode (spec F9). */
export function showModeSwitch(modes: readonly ModeOption[]): boolean {
  return modes.length > 1;
}

/**
 * A River path that keeps the reader's mode: `/following?mode=civic`. The default mode (empty)
 * adds nothing, so links stay short.
 */
export function withMode(path: string, mode: string | undefined): string {
  if (!mode) return path;
  const [base, hash] = path.split("#", 2);
  const join = base!.includes("?") ? "&" : "?";
  return `${base}${join}mode=${encodeURIComponent(mode)}${hash === undefined ? "" : `#${hash}`}`;
}

/** The mode a page was opened with (`?mode=`), lowercased; "" for the instance's default. */
export function modeFromSearch(search: string): string {
  const value = new URLSearchParams(search).get("mode");
  return value && /^[a-z-]{1,40}$/i.test(value) ? value.toLowerCase() : "";
}

/**
 * The theme for a page that has no feed response to ask (the Following page): Civic for the civic
 * mode, else Mosaic. The feed itself always takes the theme the API names.
 */
export function themeForMode(mode: string): "mosaic" | "civic" {
  return mode === "civic" ? "civic" : "mosaic";
}

/** The small tag beside a plugin's title: a working plugin, or a slot waiting on data. */
export function pluginTag(output: PluginOutput): string {
  return output.type === "placeholder" ? "Plugin slot" : "Plugin";
}

/** "Waiting on a data source (Open States, Geocodio or Cicero)." */
export function waitingOnText(sources: readonly string[]): string {
  if (sources.length === 0) return "Waiting on a data source.";
  const list =
    sources.length === 1 ? sources[0] : `${sources.slice(0, -1).join(", ")} or ${sources[sources.length - 1]}`;
  return `Waiting on a data source (${list}).`;
}

/** The line under a Coming up entry: "Voting closes · Longmont Civic Hub". */
export function dateEntryDetail(entry: DateEntry): string {
  return `${entry.what === "deadline" ? "Voting closes" : "Starts"} · ${entry.spaceName}`;
}
