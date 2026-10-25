// Where a follow came from (migration 20261025172932_follow_origin, Adam 2026-10-25): the follow
// box or a stream rule ('manual'), the seed copy at sign-up ('seed'), or "Import from Bluesky"
// ('bluesky_import', naming the imported account by DID, with its handle for display). Rows from
// before the migration read 'unknown'. 'linked' is reserved for linked accounts, later.
//
// The code may deploy before the migration lands (CLAUDE.md "Database"), so inserts name the
// origin columns only once river.follows has them. The check is one information_schema read per
// process once it answers yes, and again at most once a minute while it answers no.
import type { Db } from "../../db/context.js";

export type FollowOrigin =
  | { origin: "manual" }
  | { origin: "seed" }
  | { origin: "bluesky_import"; ref: string; label?: string | null };

export const MANUAL: FollowOrigin = { origin: "manual" };
export const SEED: FollowOrigin = { origin: "seed" };

const RECHECK_MS = 60_000;
let known: boolean | undefined;
let checkedAt = 0;

/** Whether river.follows has the origin columns yet. */
export async function hasFollowOrigin(db: Db, now: number = Date.now()): Promise<boolean> {
  if (known === true) return true;
  if (known === false && now - checkedAt < RECHECK_MS) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'river' AND table_name = 'follows' AND column_name = 'origin'`,
  );
  known = rows.length > 0;
  checkedAt = now;
  return known;
}

/** Forgets the answer (tests). */
export function resetFollowOriginCheck(): void {
  known = undefined;
  checkedAt = 0;
}

/** The three origin values, in column order (origin, origin_ref, origin_label). */
export function originValues(origin: FollowOrigin): [string, string | null, string | null] {
  if (origin.origin === "bluesky_import") return [origin.origin, origin.ref, origin.label ?? null];
  return [origin.origin, null, null];
}
