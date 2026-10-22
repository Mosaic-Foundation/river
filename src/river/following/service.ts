// A member's follows (spec F6, F7, 3.1, 4.2): following what the follow box resolved, the
// Following page's Spaces, Quiet and Ended lists, and the stream rules. Every function here runs
// inside the caller's forAccount() transaction, so row-level security limits it to the member's
// own follows, circles and circle members (check 27); spaces and streams are shared rows.
//
// Rules in river.follows (one per account, space and stream; UNIQUE NULLS NOT DISTINCT):
//   - (space, no stream, follow): the whole space.
//   - (space, stream, follow, ends_with_stream): just this stream, until the process ends.
//   - (space, stream, mute, ends_with_stream): this stream stays hidden inside the space.
// When a stream ends, the refresh (river.mark_stream_follows_ended) sets ended_at on its rules,
// which moves them from Spaces to Ended; the daily job deletes them 90 days later.
import type { Db, RiverDb } from "../../db/context.js";
import type { SpaceCategory, SpacePreview } from "../../shared/items/index.js";
import { SPACE_COLUMNS, type SpaceRow } from "../feed/spaces.js";
import { upsertSpace } from "../feed/store.js";
import { addressOf, kindLabel } from "./resolve.js";

/** Spec F7: a followed space with no new item in this many days is Quiet. */
export const QUIET_DAYS = 90;
/** Known streams the Following page lists per hub space (newest first), besides those with rules. */
export const STREAMS_PER_SPACE = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.toLowerCase());
}

/** A request the member can fix: a 4xx with a sentence to show. */
export class FollowingError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FollowingError";
  }
}

export type Rule = "follow" | "mute";

/** Ensures the stream row exists (shared) and returns its id; a known title is kept. */
export async function ensureStream(db: Db, spaceId: string, key: string, title?: string | null): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO river.streams AS st (space_id, key, title) VALUES ($1, $2, $3)
     ON CONFLICT (space_id, key) DO UPDATE SET title = coalesce(st.title, EXCLUDED.title)
     RETURNING id`,
    [spaceId, key, title ?? null],
  );
  if (!rows[0]) throw new Error("stream vanished between insert and select");
  return rows[0].id;
}

/**
 * Sets the member's rule for one stream (follow or mute, both "until the process ends"). A
 * stream that has already ended moves the rule straight to Ended.
 */
export async function setStreamRule(db: Db, streamId: string, rule: Rule): Promise<{ ruleId: string; spaceId: string }> {
  const { rows: streams } = await db.query<{ space_id: string }>("SELECT space_id FROM river.streams WHERE id = $1", [
    streamId,
  ]);
  const stream = streams[0];
  if (!stream) throw new FollowingError(404, "unknown_stream", "That stream isn't known here.");
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO river.follows (space_id, stream_id, rule, ends_with_stream) VALUES ($1, $2, $3, true)
     ON CONFLICT (account_id, space_id, stream_id) DO UPDATE SET rule = EXCLUDED.rule, ends_with_stream = true
     RETURNING id`,
    [stream.space_id, streamId, rule],
  );
  await db.query("SELECT river.mark_stream_follows_ended($1)", [streamId]);
  return { ruleId: rows[0]!.id, spaceId: stream.space_id };
}

/** Follows a whole space (idempotent). */
export async function followSpace(db: Db, spaceId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO river.follows (space_id, stream_id, rule) VALUES ($1, NULL, 'follow')
     ON CONFLICT (account_id, space_id, stream_id) DO UPDATE SET rule = 'follow'
     RETURNING id`,
    [spaceId],
  );
  return rows[0]!.id;
}

/** Adds a space to the member's circles that these ids name (others are ignored). */
export async function addToCircles(db: Db, spaceId: string, circleIds: readonly string[]): Promise<number> {
  if (circleIds.length === 0) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO river.circle_members (circle_id, space_id)
     SELECT c.id, $1 FROM river.circles c WHERE c.id = ANY($2::uuid[])
     ON CONFLICT (circle_id, space_id) DO NOTHING`,
    [spaceId, [...circleIds]],
  );
  return rowCount ?? 0;
}

export interface FollowRequest {
  scope: "space" | "stream";
  circleIds: string[];
}

export interface FollowResult {
  space: SpaceRow;
  ruleId: string;
  streamId: string | null;
}

/**
 * Confirms a follow (spec F6): stores the space if it is new, then the rule, then the circles.
 * "Just this stream" needs a preview that named one stream.
 */
export async function followPreview(db: RiverDb, preview: SpacePreview, request: FollowRequest): Promise<FollowResult> {
  if (request.scope === "stream" && !preview.stream) {
    throw new FollowingError(400, "not_a_stream", "That address isn't a single stream; follow the whole space.");
  }
  const space = await upsertSpace(db, preview);
  let ruleId: string;
  let streamId: string | null = null;
  if (request.scope === "stream" && preview.stream) {
    streamId = await ensureStream(db, space.id, preview.stream.key, preview.stream.title);
    ruleId = (await setStreamRule(db, streamId, "follow")).ruleId;
  } else {
    ruleId = await followSpace(db, space.id);
  }
  await addToCircles(db, space.id, request.circleIds);
  return { space, ruleId, streamId };
}

/**
 * Unfollows a space (spec F7 "unfollow"): its whole-space follow and every stream rule still in
 * effect, and its place in the member's circles. Ended rules stay under Ended until cleared.
 */
export async function unfollowSpace(db: Db, spaceId: string): Promise<number> {
  const { rowCount } = await db.query("DELETE FROM river.follows WHERE space_id = $1 AND ended_at IS NULL", [spaceId]);
  await db.query("DELETE FROM river.circle_members WHERE space_id = $1", [spaceId]);
  return rowCount ?? 0;
}

/** Removes one stream rule: unmute, stop following just that stream, or clear an Ended one. */
export async function removeRule(db: Db, ruleId: string): Promise<void> {
  const { rowCount } = await db.query("DELETE FROM river.follows WHERE id = $1 AND stream_id IS NOT NULL", [ruleId]);
  if (!rowCount) throw new FollowingError(404, "unknown_rule", "That rule isn't one of yours.");
}

// ---------------------------------------------------------------------------------------------
// The Following page (spec F7)
// ---------------------------------------------------------------------------------------------

export interface StreamView {
  id: string;
  key: string;
  title: string;
  status: "open" | "ended";
  /** The member's rule for this stream, or null. */
  rule: Rule | null;
  ruleId: string | null;
}

export interface SpaceView {
  id: string;
  name: string;
  iconUrl: string | null;
  adapter: string;
  category: SpaceCategory | null;
  kind: string;
  address: string;
  /** Followed as a whole (else only through stream rules). */
  following: boolean;
  ruleId: string | null;
  quiet: boolean;
  newestItemAt: string | null;
  /** A quiet note when the last refresh failed (spec F6 wording). */
  lastError: string | null;
  circleIds: string[];
  /** Streams with the member's rules first, then other known streams (hub spaces only). */
  streams: StreamView[];
}

export interface EndedView {
  ruleId: string;
  rule: Rule;
  endedAt: string;
  space: { id: string; name: string; iconUrl: string | null; adapter: string; address: string };
  stream: { id: string; key: string; title: string };
}

export interface CircleView {
  id: string;
  name: string;
  color: string | null;
  role: "civic" | null;
  spaceIds: string[];
}

export interface FollowingPage {
  spaces: SpaceView[];
  /** Ids of quiet spaces (a subset of `spaces`), for the Quiet tab. */
  quiet: string[];
  ended: EndedView[];
  circles: CircleView[];
}

interface RuleRow {
  id: string;
  space_id: string;
  stream_id: string | null;
  rule: Rule;
  ended_at: Date | null;
  key: string | null;
  title: string | null;
  status: "open" | "ended" | null;
}

/** The process id at the end of a stream key, for a stream that has no title yet. */
function keyTitle(key: string): string {
  const id = key.split("/").pop() ?? key;
  return `Process ${id}`;
}

/**
 * The SQL condition for a quiet space (spec F7, 3.1): fetched at least once, no item newer than
 * the cutoff, and never a sample. `$n` is the cutoff's parameter.
 */
function quietSql(alias: string, param: string): string {
  return `${alias}.adapter <> 'sample'
          AND ${alias}.last_fetched_at IS NOT NULL
          AND coalesce(${alias}.newest_item_at, '-infinity'::timestamptz) < ${param}::timestamptz`;
}

/** The cutoff for Quiet: the River's clock (TEST_CLOCK_NOW in tests) minus 90 days. */
export function quietCutoff(now: Date): Date {
  return new Date(now.getTime() - QUIET_DAYS * 24 * 60 * 60 * 1000);
}

/** Everything the Following page shows, from the member's own rows. Runs inside forAccount(). */
export async function followingPage(db: Db, now: Date): Promise<FollowingPage> {
  const cutoff = quietCutoff(now).toISOString();
  const { rows: rules } = await db.query<RuleRow>(
    `SELECT f.id, f.space_id, f.stream_id, f.rule, f.ended_at, st.key,
            coalesce(st.title, (SELECT i.title FROM river.items i
                                 WHERE i.space_id = st.space_id AND i.stream_key = st.key
                                   AND i.title IS NOT NULL AND NOT i.hidden
                                 ORDER BY i.published_at LIMIT 1)) AS title,
            st.status
       FROM river.follows f
       LEFT JOIN river.streams st ON st.id = f.stream_id
      ORDER BY f.created_at, f.id`,
  );
  const spaceIds = [...new Set(rules.map((r) => r.space_id))];
  const { rows: spaceRows } = await db.query<SpaceRow & { quiet: boolean }>(
    `SELECT ${SPACE_COLUMNS}, (${quietSql("s", "$2")}) AS quiet
       FROM river.spaces s WHERE s.id = ANY($1::uuid[])
      ORDER BY lower(s.name), s.id`,
    [spaceIds, cutoff],
  );
  const { rows: members } = await db.query<{ circle_id: string; space_id: string }>(
    "SELECT circle_id, space_id FROM river.circle_members",
  );
  const circleIdsBySpace = new Map<string, string[]>();
  for (const m of members) circleIdsBySpace.set(m.space_id, [...(circleIdsBySpace.get(m.space_id) ?? []), m.circle_id]);

  // Known streams of the hub spaces on the page, newest first, a few per space.
  const hubIds = spaceRows.filter((s) => s.adapter === "civic_hub").map((s) => s.id);
  const { rows: known } = await db.query<{ id: string; space_id: string; key: string; title: string | null; status: "open" | "ended" }>(
    `SELECT id, space_id, key, title, status FROM (
       SELECT st.id, st.space_id, st.key, st.status,
              coalesce(st.title, (SELECT i.title FROM river.items i
                                   WHERE i.space_id = st.space_id AND i.stream_key = st.key
                                     AND i.title IS NOT NULL AND NOT i.hidden
                                   ORDER BY i.published_at LIMIT 1)) AS title,
              row_number() OVER (PARTITION BY st.space_id ORDER BY n.newest DESC NULLS LAST, st.key) AS rank
         FROM river.streams st
         JOIN LATERAL (SELECT max(i.published_at) AS newest FROM river.items i
                        WHERE i.space_id = st.space_id AND i.stream_key = st.key AND NOT i.hidden) n ON true
        WHERE st.space_id = ANY($1::uuid[]) AND n.newest IS NOT NULL
     ) ranked
     WHERE rank <= $2
     ORDER BY space_id, rank`,
    [hubIds, STREAMS_PER_SPACE],
  );

  const spaces: SpaceView[] = [];
  const ended: EndedView[] = [];
  for (const row of spaceRows) {
    const own = rules.filter((r) => r.space_id === row.id);
    const whole = own.find((r) => r.stream_id === null && r.rule === "follow");
    const active = own.filter((r) => r.stream_id !== null && r.ended_at === null);
    const address = addressOf(row);
    for (const r of own.filter((r) => r.stream_id !== null && r.ended_at !== null)) {
      ended.push({
        ruleId: r.id,
        rule: r.rule,
        endedAt: r.ended_at!.toISOString(),
        space: { id: row.id, name: row.name, iconUrl: row.icon_url, adapter: row.adapter, address },
        stream: { id: r.stream_id!, key: r.key ?? "", title: r.title ?? keyTitle(r.key ?? "") },
      });
    }
    if (!whole && active.length === 0) continue; // only ended rules: shown under Ended alone

    const streams: StreamView[] = active.map((r) => ({
      id: r.stream_id!,
      key: r.key ?? "",
      title: r.title ?? keyTitle(r.key ?? ""),
      status: r.status ?? "open",
      rule: r.rule,
      ruleId: r.id,
    }));
    const endedStreams = new Set(own.filter((r) => r.ended_at !== null).map((r) => r.stream_id));
    if (whole) {
      for (const k of known.filter((k) => k.space_id === row.id)) {
        if (streams.some((s) => s.id === k.id) || endedStreams.has(k.id)) continue;
        streams.push({ id: k.id, key: k.key, title: k.title ?? keyTitle(k.key), status: k.status, rule: null, ruleId: null });
      }
    }
    spaces.push({
      id: row.id,
      name: row.name,
      iconUrl: row.icon_url,
      adapter: row.adapter,
      category: row.category,
      kind: kindLabel(row.adapter, row.network, row.category),
      address,
      following: Boolean(whole),
      ruleId: whole?.id ?? null,
      quiet: Boolean(whole) && row.quiet,
      newestItemAt: row.newest_item_at ? row.newest_item_at.toISOString() : null,
      lastError: row.fetch_status && row.fetch_status !== "ok" ? row.last_error : null,
      circleIds: circleIdsBySpace.get(row.id) ?? [],
      streams,
    });
  }
  ended.sort((a, b) => b.endedAt.localeCompare(a.endedAt));

  const { rows: circleRows } = await db.query<{ id: string; name: string; color: string | null; role: "civic" | null }>(
    "SELECT id, name, color, role FROM river.circles ORDER BY sort, lower(name), id",
  );
  const circles = circleRows.map((c) => ({
    ...c,
    spaceIds: members.filter((m) => m.circle_id === c.id).map((m) => m.space_id),
  }));
  return { spaces, quiet: spaces.filter((s) => s.quiet).map((s) => s.id), ended, circles };
}

/** "Unfollow all quiet spaces" (spec F7): every whole-space follow that is quiet now. */
export async function unfollowQuiet(db: Db, now: Date): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT s.id FROM river.follows f JOIN river.spaces s ON s.id = f.space_id
      WHERE f.stream_id IS NULL AND f.rule = 'follow' AND ${quietSql("s", "$1")}`,
    [quietCutoff(now).toISOString()],
  );
  for (const { id } of rows) await unfollowSpace(db, id);
  return rows.map((r) => r.id);
}

/** True when the member follows the space (as a whole, or one of its streams). */
export async function followsSpace(db: Db, spaceId: string): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM river.follows WHERE space_id = $1 AND rule = 'follow' LIMIT 1", [spaceId]);
  return rows.length > 0;
}
