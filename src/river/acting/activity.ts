// Your activity (ADR-010 §7): every act the River made in the member's name, newest first, read
// only. Previews that were never sent aren't acts and aren't listed. Everything here goes to the
// page as plain data: no request bodies (the page shows those only in a preview), no credentials,
// and links only when they are https.
//
// Code may deploy before the acting tables' migration lands (CLAUDE.md "Database"); until it does,
// the list is empty. The check is one catalog read per process once it answers yes, and at most
// once a minute before.
import { forAccount, type ClientSource, type Db } from "../../db/context.js";
import type { ActStatus } from "./acts.js";
import type { Verb } from "./limits.js";

export const ACTIVITY_PAGE_SIZE = 50;

export interface ActivityEntry {
  id: string;
  /** When it was sent (ISO 8601). */
  at: string;
  channel: "fediverse" | "space";
  verb: Verb;
  status: Exclude<ActStatus, "previewed">;
  /** The server or space it went to, and how the member saw the target ("@ana@example.social"). */
  targetHost: string;
  targetLabel: string | null;
  /** What it answered, while the River still names it. */
  subjectTitle: string | null;
  subjectUrl: string | null;
  /** What it made, on the other side. */
  remoteUrl: string | null;
  errorCode: string | null;
  /** The other side's own words (plain text, at most 300 characters). */
  errorMessage: string | null;
  /** The act this one undid. */
  undoesId: string | null;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  nextCursor: string | null;
}

/** A cursor this list didn't give: the route answers 400. */
export class ActivityCursorError extends Error {}

const RECHECK_MS = 60_000;
let tableKnown: boolean | undefined;
let checkedAt = 0;

/** Whether river.member_actions exists yet. */
export async function hasActivityTable(db: Db, now: number = Date.now()): Promise<boolean> {
  if (tableKnown === true) return true;
  if (tableKnown === false && now - checkedAt < RECHECK_MS) return false;
  const { rows } = await db.query<{ found: boolean }>("SELECT to_regclass('river.member_actions') IS NOT NULL AS found");
  tableKnown = rows[0]?.found === true;
  checkedAt = now;
  return tableKnown;
}

/** Forgets the answer (tests). */
export function resetActivityTableCheck(): void {
  tableKnown = undefined;
  checkedAt = 0;
}

/** An https URL as given, or null: nothing else becomes a link on the page. */
export function httpsOrNull(value: string | null): string | null {
  if (value === null) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Cursor {
  at: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  if (value.length > 200) throw new ActivityCursorError("cursor is not one this list gave");
  const [iso, id, ...rest] = Buffer.from(value, "base64url").toString("utf8").split("|");
  const at = new Date(iso ?? "");
  if (rest.length > 0 || id === undefined || !UUID.test(id) || Number.isNaN(at.getTime())) {
    throw new ActivityCursorError("cursor is not one this list gave");
  }
  return { at, id };
}

interface Row {
  id: string;
  sent_at: Date;
  channel: ActivityEntry["channel"];
  verb: Verb;
  status: ActivityEntry["status"];
  target_host: string;
  target_label: string | null;
  subject_title: string | null;
  subject_url: string | null;
  remote_url: string | null;
  error_code: string | null;
  error_message: string | null;
  undoes_id: string | null;
}

/** One page of the member's activity, newest first. */
export async function listActivity(
  instanceId: string,
  accountId: string,
  cursor?: string,
  source?: ClientSource,
): Promise<ActivityPage> {
  const after = cursor === undefined ? undefined : decodeCursor(cursor);
  return forAccount(
    instanceId,
    accountId,
    async (db) => {
      if (!(await hasActivityTable(db))) return { entries: [], nextCursor: null };
      const { rows } = await db.query<Row>(
        `SELECT id, sent_at, channel, verb, status, target_host, target_label, subject_title, subject_url,
                remote_url, error_code, error_message, undoes_id
           FROM river.member_actions
          WHERE account_id = $1 AND status <> 'previewed' AND sent_at IS NOT NULL
            AND ($2::timestamptz IS NULL OR (sent_at, id) < ($2::timestamptz, $3::uuid))
          ORDER BY sent_at DESC, id DESC
          LIMIT $4`,
        [accountId, after?.at ?? null, after?.id ?? null, ACTIVITY_PAGE_SIZE + 1],
      );
      const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
      const last = page[page.length - 1];
      return {
        entries: page.map((row) => ({
          id: row.id,
          at: row.sent_at.toISOString(),
          channel: row.channel,
          verb: row.verb,
          status: row.status,
          targetHost: row.target_host,
          targetLabel: row.target_label,
          subjectTitle: row.subject_title,
          subjectUrl: httpsOrNull(row.subject_url),
          remoteUrl: httpsOrNull(row.remote_url),
          errorCode: row.error_code,
          errorMessage: row.error_message,
          undoesId: row.undoes_id,
        })),
        nextCursor: rows.length > ACTIVITY_PAGE_SIZE && last ? encodeCursor({ at: last.sent_at, id: last.id }) : null,
      };
    },
    source,
  );
}
