// Which Bluesky spaces a feed open refreshes (docs/spec/bluesky-1.md item 4; DECISIONS.md "Refreshing
// hundreds of Bluesky accounts"). A member who imports their Bluesky follows can follow hundreds
// of accounts, each one AppView request (or two) through a guard that sends at most 2 at a time
// to one host, inside a 6 s response budget and Vercel's function limits. So each open refreshes
// a capped, rotating subset:
//
//   1. Due: a space is due when it was never fetched, or when its last fetch is older than an
//      interval that grows with how long the account has been quiet (an account that posted today
//      is due every 2 minutes, the River's floor; one quiet for a month, every 6 hours).
//   2. Order: due spaces that were fetched before, most recent poster first (newest_item_at), then
//      the longest-waiting; never-fetched spaces (just imported) are taken in the order given.
//   3. Cap: at most BLUESKY_REFRESH_CAP per open. Up to NEW_SHARE of the slots go to never-fetched
//      spaces, so an import of hundreds fills in over the next opens without starving the active
//      accounts; slots one group doesn't use go to the other.
//
// A refreshed space isn't due again until its interval passes, so the next open reaches others:
// that is the rotation. Other adapters are unchanged: every stale space is claimed, as before.
import type { SpaceRow } from "./spaces.js";

/** Bluesky spaces refreshed per feed open (ADR-009 item 6). */
export const BLUESKY_REFRESH_CAP = 12;
/** Of those, at most this many never-fetched ones. */
export const NEW_SHARE = 4;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long a space waits between refreshes, from how long ago it last posted. */
export function refreshInterval(newestItemAt: Date | null, now: number): number {
  const quiet = newestItemAt ? now - newestItemAt.getTime() : Number.POSITIVE_INFINITY;
  if (quiet <= DAY) return 2 * MINUTE;
  if (quiet <= 7 * DAY) return 15 * MINUTE;
  if (quiet <= 30 * DAY) return HOUR;
  return 6 * HOUR;
}

type Rotatable = Pick<SpaceRow, "id" | "adapter" | "newest_item_at" | "last_fetched_at">;

/** True when the space should be refreshed on this open. */
export function isDue(space: Rotatable, now: number): boolean {
  if (!space.last_fetched_at) return true;
  return now - space.last_fetched_at.getTime() >= refreshInterval(space.newest_item_at, now);
}

/**
 * The spaces to try to claim on this open: every non-Bluesky space as given, and at most
 * `cap` due Bluesky spaces chosen as the header says. Order of the result: non-Bluesky first.
 */
export function chooseForRefresh<T extends Rotatable>(
  rows: readonly T[],
  now: number,
  cap = BLUESKY_REFRESH_CAP,
  newShare = NEW_SHARE,
): T[] {
  const others = rows.filter((r) => r.adapter !== "atproto");
  const due = rows.filter((r) => r.adapter === "atproto" && isDue(r, now));
  const fresh = due.filter((r) => !r.last_fetched_at);
  const known = due
    .filter((r) => r.last_fetched_at)
    .sort(
      (a, b) =>
        (b.newest_item_at?.getTime() ?? 0) - (a.newest_item_at?.getTime() ?? 0) ||
        (a.last_fetched_at?.getTime() ?? 0) - (b.last_fetched_at?.getTime() ?? 0),
    );
  const newSlots = Math.min(fresh.length, newShare, cap);
  const knownTaken = known.slice(0, cap - newSlots);
  const freshTaken = fresh.slice(0, cap - knownTaken.length);
  return [...others, ...knownTaken, ...freshTaken];
}
