// ADR-010 §9: the River's per-account limits on acts, one table for every channel (fediverse
// posting and space actions). Counted in the database, in rolling windows, under a row lock on the
// account (acts.ts), so two requests can't both take the last allowance.
import type { Db } from "../../db/context.js";

export const VERBS = [
  "post", "reply", "comment", "poll_answer",
  "boost", "unboost", "favourite", "unfavourite", "support", "rsvp", "withdraw",
  "follow", "unfollow",
  "delete",
] as const;
export type Verb = (typeof VERBS)[number];

export type LimitKind = "text" | "toggle" | "follow" | "delete";

/** Each verb's kind; the migration's CHECK (member_actions_limit_kind) says the same. */
export function limitKindOf(verb: Verb): LimitKind {
  switch (verb) {
    case "post":
    case "reply":
    case "comment":
    case "poll_answer":
      return "text";
    case "follow":
    case "unfollow":
      return "follow";
    case "delete":
      return "delete";
    default:
      return "toggle";
  }
}

export interface Window {
  max: number;
  ms: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** ADR-010 §9's table. */
export const ACT_LIMITS: Record<LimitKind, readonly Window[]> = {
  text: [{ max: 30, ms: HOUR }, { max: 100, ms: DAY }],
  toggle: [{ max: 120, ms: HOUR }, { max: 600, ms: DAY }],
  follow: [{ max: 50, ms: DAY }],
  delete: [{ max: 30, ms: 30 * MINUTE }],
};

/** How long a preview may wait for Send (ADR-010 §4); the daily job purges older ones. */
export const PREVIEW_TTL_MS = 15 * MINUTE;

/**
 * When the account may next make an act of this kind, or undefined if it may now. Counts every row
 * that was sent or attempted (anything but a preview) by when it was sent. Call it inside the
 * transaction that holds the account's row lock.
 */
export async function nextAllowedAt(db: Db, accountId: string, kind: LimitKind, at: Date): Promise<Date | undefined> {
  let latest: Date | undefined;
  for (const window of ACT_LIMITS[kind]) {
    const since = new Date(at.getTime() - window.ms);
    // A row is sent at most PREVIEW_TTL_MS after it was created, so created_at bounds the scan.
    const { rows } = await db.query<{ sent_at: Date }>(
      `SELECT sent_at FROM river.member_actions
        WHERE account_id = $1 AND limit_kind = $2 AND status <> 'previewed'
          AND created_at > $3 AND sent_at > $4
        ORDER BY sent_at DESC
        OFFSET $5 LIMIT 1`,
      [accountId, kind, new Date(since.getTime() - PREVIEW_TTL_MS), since, window.max - 1],
    );
    // The max-th most recent act in the window: the account is at the limit until it leaves.
    const oldestCounted = rows[0]?.sent_at;
    if (oldestCounted) {
      const free = new Date(oldestCounted.getTime() + window.ms);
      if (!latest || free > latest) latest = free;
    }
  }
  return latest;
}
