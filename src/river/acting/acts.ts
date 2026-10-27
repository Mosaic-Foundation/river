// Every act's row in river.member_actions (ADR-010 §4, §7, §9, §10), written before anything is
// sent. The sending code (A3 for the fediverse, B3 for spaces) uses three steps:
//
//   1. createPreview()  a text act's preview: the exact request, stored as 'previewed' with the
//                       account's session epoch. Nothing is counted or sent.
//   2. claimPreview()   Send, naming the preview; or startToggle() for a toggle act, which has
//                       no preview. Either one takes a row lock on the account, checks the session
//                       epoch and ADR-010 §9's limits, marks the row in flight and commits, all
//                       before any outbound request, so no lock or pooler connection is held while
//                       the other side answers and two requests can't both take the last allowance.
//   3. finishAct()      records what came back.
//
// A row in flight reads 'unknown' (with sent_at set) until finishAct() runs: if the function dies
// while the other side is answering, the member sees "We couldn't tell whether … got it", which is
// the truth. A preview can be sent once: a second Send finds it no longer 'previewed'.
import { forAccount, type ClientSource, type RiverDb } from "../../db/context.js";
import { limitKindOf, nextAllowedAt, PREVIEW_TTL_MS, type Verb } from "./limits.js";

export type ActStatus = "previewed" | "sent" | "held" | "failed" | "unknown" | "undone";

/** Why an act wasn't started. Nothing was sent. */
export class ActRefused extends Error {
  constructor(
    readonly code:
      | "limit"
      | "session_ended"
      | "preview_expired"
      | "already_sent"
      | "not_found"
      | "link_inactive",
    /** For `limit`: when the account may act again. */
    readonly retryAt?: Date,
  ) {
    super(`Act refused: ${code}`);
    this.name = "ActRefused";
  }
}

/** What an act is, as the member chose it. Never a credential. */
export interface ActInput {
  channel: "fediverse" | "space";
  verb: Verb;
  /** The linked account or grant it goes through. */
  linkedAccountId?: string;
  /** The server or space host it goes to, and how the member sees it ("@ana@example.social"). */
  targetHost: string;
  targetLabel?: string;
  /** The River item it answers, with its title and link for Your activity. */
  itemId?: string;
  subjectTitle?: string;
  subjectUrl?: string;
  /** The exact request (method, URL, fields), as previewed and sent. */
  request?: unknown;
  /** The act this one undoes. */
  undoesId?: string;
}

/** Who is acting: the signed-in member and the session epoch their cookie carried. */
export interface Actor {
  instanceId: string;
  accountId: string;
  sessionEpoch: number;
}

export interface ActRow {
  id: string;
  status: ActStatus;
  verb: Verb;
  request: unknown;
  linked_account_id: string | null;
  target_host: string;
  session_epoch: number;
  created_at: Date;
  sent_at: Date | null;
}

const RETURNING = "id, status, verb, request, linked_account_id, target_host, session_epoch, created_at, sent_at";

/**
 * Locks the account's row for the rest of the transaction and returns its session epoch. Every
 * claim takes this lock first, so claims for one account run one at a time.
 */
async function lockAccount(db: RiverDb, accountId: string): Promise<number> {
  const { rows } = await db.query<{ session_epoch: number }>(
    "SELECT session_epoch FROM river.accounts WHERE id = $1 FOR UPDATE",
    [accountId],
  );
  if (!rows[0]) throw new ActRefused("session_ended");
  return rows[0].session_epoch;
}

/** The link must still be the member's and active; marks it used. */
async function useLink(db: RiverDb, linkedAccountId: string | undefined, at: Date): Promise<void> {
  if (linkedAccountId === undefined) return;
  const { rowCount } = await db.query(
    "UPDATE river.linked_accounts SET last_used_at = $2 WHERE id = $1 AND status = 'active'",
    [linkedAccountId, at],
  );
  if (rowCount !== 1) throw new ActRefused("link_inactive");
}

async function checkLimits(db: RiverDb, accountId: string, verb: Verb, at: Date): Promise<void> {
  const retryAt = await nextAllowedAt(db, accountId, limitKindOf(verb), at);
  if (retryAt) throw new ActRefused("limit", retryAt);
}

function rowValues(input: ActInput, sessionEpoch: number) {
  return {
    channel: input.channel,
    verb: input.verb,
    limit_kind: limitKindOf(input.verb),
    linked_account_id: input.linkedAccountId,
    target_host: input.targetHost,
    target_label: input.targetLabel,
    item_id: input.itemId,
    subject_title: input.subjectTitle,
    subject_url: input.subjectUrl,
    request: input.request === undefined ? undefined : JSON.stringify(input.request),
    undoes_id: input.undoesId,
    session_epoch: sessionEpoch,
  };
}

/** Stores a text act's preview. Refused if the session's epoch is no longer the account's. */
export async function createPreview(actor: Actor, input: ActInput, at = new Date(), source?: ClientSource): Promise<ActRow> {
  return forAccount(
    actor.instanceId,
    actor.accountId,
    async (db) => {
      const { rows } = await db.query<{ session_epoch: number }>("SELECT session_epoch FROM river.accounts WHERE id = $1", [
        actor.accountId,
      ]);
      if (rows[0]?.session_epoch !== actor.sessionEpoch) throw new ActRefused("session_ended");
      const row = await db.insert<ActRow>("member_actions", { ...rowValues(input, actor.sessionEpoch), created_at: at });
      return row;
    },
    source,
  );
}

/**
 * Send: claims a stored preview for sending. Checks, under the account's lock, that the session
 * and the preview were both made at the account's current epoch, that the preview is unsent and
 * under 15 minutes old, that the link is active, and the limits; then marks it in flight and
 * commits. Returns the row, whose stored request is what the caller sends.
 */
export async function claimPreview(actor: Actor, actId: string, at = new Date(), source?: ClientSource): Promise<ActRow> {
  return forAccount(
    actor.instanceId,
    actor.accountId,
    async (db) => {
      const epoch = await lockAccount(db, actor.accountId);
      if (epoch !== actor.sessionEpoch) throw new ActRefused("session_ended");
      const { rows } = await db.query<ActRow>(`SELECT ${RETURNING} FROM river.member_actions WHERE id = $1`, [actId]);
      const preview = rows[0];
      if (!preview) throw new ActRefused("not_found");
      if (preview.status !== "previewed") throw new ActRefused("already_sent");
      if (preview.session_epoch !== epoch) throw new ActRefused("session_ended");
      if (at.getTime() - preview.created_at.getTime() > PREVIEW_TTL_MS) throw new ActRefused("preview_expired");
      await useLink(db, preview.linked_account_id ?? undefined, at);
      await checkLimits(db, actor.accountId, preview.verb, at);
      const claimed = await db.query<ActRow>(
        `UPDATE river.member_actions SET status = 'unknown', sent_at = $2 WHERE id = $1 AND status = 'previewed' RETURNING ${RETURNING}`,
        [actId, at],
      );
      if (!claimed.rows[0]) throw new ActRefused("already_sent");
      return claimed.rows[0];
    },
    source,
  );
}

/** A toggle act (and every undo): written and claimed in one step, with no stored preview. */
export async function startToggle(actor: Actor, input: ActInput, at = new Date(), source?: ClientSource): Promise<ActRow> {
  return forAccount(
    actor.instanceId,
    actor.accountId,
    async (db) => {
      const epoch = await lockAccount(db, actor.accountId);
      if (epoch !== actor.sessionEpoch) throw new ActRefused("session_ended");
      await useLink(db, input.linkedAccountId, at);
      await checkLimits(db, actor.accountId, input.verb, at);
      return db.insert<ActRow>("member_actions", {
        ...rowValues(input, epoch),
        status: "unknown",
        created_at: at,
        sent_at: at,
      });
    },
    source,
  );
}

/** What came back from the other side. */
export interface ActOutcome {
  status: Exclude<ActStatus, "previewed" | "undone">;
  remoteId?: string;
  remoteUrl?: string;
  errorCode?: string;
  /** The other side's own words: stored as plain text, cut to 300 characters (ADR-010 §9). */
  errorMessage?: string;
}

export const ERROR_MESSAGE_MAX = 300;

/** Records the outcome of an act in flight. Returns false if the row wasn't in flight. */
export async function finishAct(actor: Actor, actId: string, outcome: ActOutcome, source?: ClientSource): Promise<boolean> {
  const message =
    outcome.errorMessage === undefined ? null : Array.from(outcome.errorMessage).slice(0, ERROR_MESSAGE_MAX).join("");
  return forAccount(
    actor.instanceId,
    actor.accountId,
    async (db) => {
      const { rowCount } = await db.query(
        `UPDATE river.member_actions
            SET status = $2, remote_id = $3, remote_url = $4, error_code = $5, error_message = $6
          WHERE id = $1 AND status = 'unknown' AND sent_at IS NOT NULL`,
        [actId, outcome.status, outcome.remoteId ?? null, outcome.remoteUrl ?? null, outcome.errorCode ?? null, message],
      );
      return rowCount === 1;
    },
    source,
  );
}
