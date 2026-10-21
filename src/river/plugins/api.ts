// The River's plugin API (spec 4.7; decisions log rows 23-24; architecture A10). Plugins are the
// same family as Civic Hub plugins: a manifest that declares its kind, the surfaces it can appear
// on and the capabilities it needs. v1 has first-party "view" plugins only, bundled at build time
// and run in-process. A plugin is a function from this file's ViewApi to a PluginOutput: it gets
// read-only copies of the current view's items and the River's clock, and nothing else (no
// database, no network, no request, no account). Lint keeps src/river/plugins/builtin/ importing
// only this file (eslint.config.js).
//
// This file holds types and constants only, so a plugin depends on nothing that can do anything.

/** Where a plugin can appear in the River (decisions log row 24). */
export const SURFACES = ["river.panel", "river.mode-header", "river.card-action"] as const;
export type Surface = (typeof SURFACES)[number];

/** What a plugin may ask for. v1 has one: reading the current view's items. */
export const CAPABILITIES = ["read:items"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** The manifest (spec 4.7): `{ id, kind: "view", version, surfaces, title, capabilities }`. */
export interface PluginManifest {
  readonly id: string;
  readonly kind: "view";
  readonly version: string;
  readonly surfaces: readonly Surface[];
  readonly title: string;
  readonly capabilities: readonly Capability[];
}

/**
 * One item of the current view, as a plugin sees it: what a card shows, never the raw activity,
 * read state or anything about the reader. Frozen before a plugin gets it.
 */
export interface PluginItem {
  readonly id: string;
  readonly kind: "post" | "article" | "podcast" | "video" | "photo" | "event" | "civic";
  readonly publishedAt: string;
  readonly title: string | null;
  /** The item's own link; null for samples. */
  readonly url: string | null;
  readonly streamKey: string | null;
  /** civic.deadline (a hub process's voting_closes_at), ISO 8601. */
  readonly deadline: string | null;
  /** An event's start, ISO 8601, when the source gives one. */
  readonly eventStart: string | null;
  readonly source: "live" | "sample";
  readonly space: { readonly id: string; readonly name: string; readonly category: string | null };
}

/** Everything a view plugin receives (capability read:items). */
export interface ViewApi {
  /** The current view's items (mode, circle, content type and search applied), newest first. */
  readonly items: readonly PluginItem[];
  /** The River's clock (TEST_CLOCK_NOW in tests), as ISO 8601. */
  readonly now: string;
}

/** A dated entry, e.g. a vote closing or an event starting (Coming up). */
export interface DateEntry {
  /** ISO 8601. */
  readonly date: string;
  /** "deadline" (voting closes) or "event" (starts). */
  readonly what: "deadline" | "event";
  readonly title: string;
  readonly spaceName: string;
  readonly itemId: string;
  readonly url: string | null;
  readonly source: "live" | "sample";
}

/**
 * What a plugin returns for the River to render. Plugins return data, never markup, so the UI
 * draws every output with its own components and the theme's tokens.
 */
export type PluginOutput =
  | { readonly type: "dates"; readonly intro: string; readonly entries: readonly DateEntry[] }
  /** A slot waiting on a data source: what it will show, and the sources it waits on. */
  | { readonly type: "placeholder"; readonly text: string; readonly waitingOn: readonly string[] };

/** A first-party view plugin: its manifest and its function. `null` hides it for this view. */
export interface ViewPlugin {
  readonly manifest: PluginManifest;
  readonly render: (api: ViewApi) => PluginOutput | null;
}
