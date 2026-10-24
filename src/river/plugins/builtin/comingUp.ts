// Coming up (spec 4.7, ui-revisions-1 item 6): up to five upcoming dates from the items the mode
// gives it (Civic: the current view; Everything: everything followed, whatever the filters), from hub
// processes' civic.deadline (voting_closes_at) and events' start times, in date order. With
// none, Civic hides it (its panel keeps the placeholder slots); Everything keeps its column and
// says there's nothing yet (ui-revisions-8 item 1). "Upcoming" means at or after the River's
// clock. One entry per process and date: a hub announces the same deadline on several activities
// (Create, civic:Start), so the newest item of each (stream, date) stands for it.
import type { DateEntry, PluginItem, ViewApi, ViewPlugin } from "../api.js";

export const COMING_UP_LIMIT = 5;

/** What Everything's Coming up says when nothing followed has an upcoming date. */
export const COMING_UP_EMPTY = "Nothing coming up yet. Votes, meetings and events from what you follow show here.";

function time(value: string | null): number | undefined {
  if (!value) return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}

function entriesOf(item: PluginItem): Array<{ at: number; entry: DateEntry }> {
  const out: Array<{ at: number; entry: DateEntry }> = [];
  const base = {
    title: item.title?.trim() || item.space.name,
    spaceName: item.space.name,
    itemId: item.id,
    url: item.url,
    source: item.source,
  };
  const deadline = time(item.deadline);
  if (deadline !== undefined) out.push({ at: deadline, entry: { ...base, date: new Date(deadline).toISOString(), what: "deadline" } });
  const start = item.kind === "event" ? time(item.eventStart) : undefined;
  if (start !== undefined) out.push({ at: start, entry: { ...base, date: new Date(start).toISOString(), what: "event" } });
  return out;
}

export function comingUp(api: ViewApi): DateEntry[] {
  const now = Date.parse(api.now);
  const seen = new Set<string>();
  const upcoming: Array<{ at: number; entry: DateEntry }> = [];
  // Items arrive newest first, so the first item seen for a (stream, date) is the newest one.
  for (const item of api.items) {
    for (const candidate of entriesOf(item)) {
      if (candidate.at < now) continue;
      const key = `${item.streamKey ?? item.id}|${candidate.entry.what}|${candidate.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      upcoming.push(candidate);
    }
  }
  upcoming.sort((a, b) => a.at - b.at || a.entry.title.localeCompare(b.entry.title));
  return upcoming.slice(0, COMING_UP_LIMIT).map((c) => c.entry);
}

export const comingUpPlugin: ViewPlugin = {
  manifest: {
    id: "coming-up",
    kind: "view",
    version: "1.0.0",
    surfaces: ["river.panel"],
    title: "Coming up",
    capabilities: ["read:items"],
  },
  render(api) {
    const entries = comingUp(api);
    if (entries.length === 0) {
      if (api.reach !== "followed") return null;
      return { type: "dates", intro: COMING_UP_EMPTY, entries };
    }
    const intro = api.reach === "followed" ? "Dates from everything you follow." : "Dates from the items in this view.";
    return { type: "dates", intro, entries };
  },
};
