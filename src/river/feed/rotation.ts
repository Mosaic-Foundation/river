// Which spaces a feed open refreshes (docs/spec/bluesky-1.md item 4; DECISIONS.md "Refreshing
// hundreds of Bluesky accounts"). A member who imports their Bluesky follows can follow hundreds
// of accounts, each one AppView request (or two) through a guard that sends at most 2 at a time
// to one host, inside a 6 s response budget and Vercel's function limits. So each open refreshes
// a capped, rotating subset:
//
//   1. Due: a space is due when it was never fetched, or when its last fetch is older than an
//      interval that grows with how long the account has been quiet (an account that posted today
//      is due every 2 minutes, the River's floor; one quiet for a month, every 6 hours).
//   2. Order: due spaces that were fetched before, most overdue first: the time since the last
//      fetch divided by the space's interval, so recency counts twice over (a recent poster's
//      shorter interval makes it due sooner and more overdue) while every due space gets its turn;
//      ties go to the most recent poster. Never-fetched spaces (just imported) are taken in the
//      order given.
//   3. Cap: at most BLUESKY_REFRESH_CAP per open. Up to NEW_SHARE of the slots go to never-fetched
//      spaces, so an import of hundreds fills in over the next opens without starving the active
//      accounts, and up to WAIT_SHARE to the due spaces that have waited longest, so busy accounts
//      can't keep quieter ones out for hours; the rest go by step 2. Slots a group doesn't use go
//      to the others.
//
// A refreshed space isn't due again until its interval passes, so the next open reaches others:
// that is the rotation.
//
// Every other adapter (hubs, fediverse accounts, feeds) has a cap too, OTHER_REFRESH_CAP per
// adapter per open, so following a few thousand feeds can't make one open fetch them all. Within
// an adapter, stale spaces (never fetched, or not in the last CLAIM_FLOOR_MS, the claim's own
// test) are taken longest-waiting first, never-fetched first of all, so each stale space gets its
// turn over the next opens.
import type { SpaceRow } from "./spaces.js";

/** Bluesky spaces refreshed per feed open (ADR-009 item 6). */
export const BLUESKY_REFRESH_CAP = 12;
/** Of those, at most this many never-fetched ones. */
export const NEW_SHARE = 4;
/** And this many of the due spaces that have waited longest (round robin). */
export const WAIT_SHARE = 4;
/** Spaces of each other adapter refreshed per feed open. */
export const OTHER_REFRESH_CAP = 12;
/** A space fetched more recently than this is never claimed (spec 4.3, store.ts CLAIM_SQL). */
export const CLAIM_FLOOR_MS = 120_000;

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
 * The spaces to try to claim on this open: at most `otherCap` stale spaces of each non-Bluesky
 * adapter, and at most `cap` due Bluesky spaces, chosen as the header says. Order of the result:
 * non-Bluesky first, in the order their adapters first appear.
 */
export function chooseForRefresh<T extends Rotatable>(
  rows: readonly T[],
  now: number,
  cap = BLUESKY_REFRESH_CAP,
  newShare = NEW_SHARE,
  waitShare = WAIT_SHARE,
  otherCap = OTHER_REFRESH_CAP,
): T[] {
  const byAdapter = new Map<string, T[]>();
  for (const r of rows) {
    if (r.adapter === "atproto") continue;
    if (r.last_fetched_at && now - r.last_fetched_at.getTime() < CLAIM_FLOOR_MS) continue;
    const group = byAdapter.get(r.adapter);
    if (group) group.push(r);
    else byAdapter.set(r.adapter, [r]);
  }
  // Never fetched first (in the order given: sort is stable), then the oldest last fetch.
  const lastFetched = (r: T) => r.last_fetched_at?.getTime() ?? 0;
  const others = [...byAdapter.values()].flatMap((group) =>
    group.sort((a, b) => lastFetched(a) - lastFetched(b)).slice(0, otherCap),
  );
  const due = rows.filter((r) => r.adapter === "atproto" && isDue(r, now));
  const fresh = due.filter((r) => !r.last_fetched_at);
  const fetched = due.filter((r) => r.last_fetched_at);
  const waited = (r: T) => now - (r.last_fetched_at as Date).getTime();
  const overdue = (r: T) => waited(r) / refreshInterval(r.newest_item_at, now);
  const byOverdue = [...fetched].sort(
    (a, b) => overdue(b) - overdue(a) || (b.newest_item_at?.getTime() ?? 0) - (a.newest_item_at?.getTime() ?? 0),
  );
  const byWait = [...fetched].sort((a, b) => waited(b) - waited(a));

  const chosen = new Set<T>(fresh.slice(0, Math.min(newShare, cap)));
  for (const r of byWait.slice(0, Math.min(waitShare, cap - chosen.size))) chosen.add(r);
  for (const r of [...byOverdue, ...fresh]) {
    if (chosen.size >= cap) break;
    chosen.add(r);
  }
  const bluesky = [...chosen];
  // Fetched spaces first (most overdue first), then the never-fetched ones, as claimed.
  bluesky.sort((a, b) => Number(!a.last_fetched_at) - Number(!b.last_fetched_at));
  return [...others, ...bluesky];
}
