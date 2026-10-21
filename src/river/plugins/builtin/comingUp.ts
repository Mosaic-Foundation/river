// Coming up (spec 4.7): up to five upcoming dates from the current view's items, from hub
// processes' civic.deadline (voting_closes_at) and events' start times, in date order. Hidden
// when there are none. "Upcoming" means at or after the River's clock. One entry per process and
// date: a hub announces the same deadline on several activities (Create, civic:Start), so the
// newest item of each (stream, date) stands for it.
import type { DateEntry, PluginItem, ViewApi, ViewPlugin } from "../api.js";

export const COMING_UP_LIMIT = 5;

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
    return entries.length === 0 ? null : { type: "dates", intro: "Dates from the items in this view.", entries };
  },
};
