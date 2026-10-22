// Writes what an adapter returned (spec 3.1, 4.2, 4.3, 4.5). Every statement runs inside the
// caller's forInstance() transaction as river_app; items, spaces and streams are shared tables, so
// the instance setting is all their policies need.
import type { Db } from "../../db/context.js";
import {
  AdapterError,
  ADAPTER_MESSAGES,
  type FetchResult,
  type NormalizedItem,
  type SpacePreview,
  type StreamUpdate,
} from "../../shared/items/index.js";
import { toPlainText } from "../../shared/sanitize/index.js";
import { SPACE_COLUMNS, type SpaceRow } from "./spaces.js";

/** A source's name, as plain text of a sane length (it came from another server). */
function spaceName(raw: string | undefined): string | undefined {
  const plain = raw ? toPlainText(raw).trim() : "";
  return plain ? plain.slice(0, 200) : undefined;
}

/** Items as jsonb records, one INSERT per page. */
function itemRecord(item: NormalizedItem) {
  return {
    source_id: item.sourceId,
    kind: item.kind,
    published_at: item.publishedAt.toISOString(),
    title: item.title ?? null,
    summary: item.summary ?? null,
    content_html: item.contentHtml ?? null,
    url: item.url ?? null,
    stream_key: item.streamKey ?? null,
    author: item.author ?? null,
    media: item.media ?? [],
    boost_of: item.boostOf ?? null,
    civic: item.civic ?? null,
    is_final_result: item.isFinalResult,
    hidden: item.hidden,
    raw: item.raw ?? null,
  };
}

/**
 * Stores one page, deduping on (space_id, source_id). An item seen again takes the newer copy of
 * everything but is_final_result, which only the stream bookkeeping (applyStreams) moves.
 */
export async function storeItems(db: Db, spaceId: string, items: readonly NormalizedItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const result = await db.query(
    `INSERT INTO river.items (space_id, source_id, kind, published_at, title, summary, content_html, url,
                              stream_key, author, media, boost_of, civic, is_final_result, hidden, raw)
     SELECT $1, x.source_id, x.kind, x.published_at, x.title, x.summary, x.content_html, x.url,
            x.stream_key, x.author, coalesce(x.media, '[]'::jsonb), x.boost_of, x.civic,
            coalesce(x.is_final_result, false), coalesce(x.hidden, false), x.raw
       FROM jsonb_to_recordset($2::jsonb) AS x(
              source_id text, kind text, published_at timestamptz, title text, summary text,
              content_html text, url text, stream_key text, author jsonb, media jsonb, boost_of jsonb,
              civic jsonb, is_final_result boolean, hidden boolean, raw jsonb)
     ON CONFLICT (space_id, source_id) DO UPDATE SET
       kind = EXCLUDED.kind,
       published_at = EXCLUDED.published_at,
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       content_html = EXCLUDED.content_html,
       url = EXCLUDED.url,
       stream_key = EXCLUDED.stream_key,
       author = EXCLUDED.author,
       media = EXCLUDED.media,
       boost_of = EXCLUDED.boost_of,
       civic = EXCLUDED.civic,
       hidden = EXCLUDED.hidden,
       raw = EXCLUDED.raw,
       fetched_at = now()`,
    [spaceId, JSON.stringify(items.map(itemRecord))],
  );
  return result.rowCount ?? 0;
}

/** source_ids already stored for a space (the fediverse adapter stops at the first known one). */
export async function knownSourceIds(db: Db, spaceId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ source_id: string }>(
    "SELECT source_id FROM river.items WHERE space_id = $1",
    [spaceId],
  );
  return new Set(rows.map((r) => r.source_id));
}

/** Space columns after a fetch. A changed actor name or icon is copied from the manifest. */
export async function applySpaceResult(db: Db, space: SpaceRow, result: FetchResult): Promise<void> {
  const s = result.space;
  const status = s.fetchStatus ?? "ok";
  const actor = (s.manifest?.actor ?? undefined) as { name?: string; preferredUsername?: string; iconUrl?: string } | undefined;
  const name = spaceName(actor?.name ?? actor?.preferredUsername);
  await db.query(
    `UPDATE river.spaces SET
       etag = CASE WHEN $2 THEN $3 ELSE etag END,
       etag_url = CASE WHEN $2 THEN $4 ELSE etag_url END,
       newest_item_at = CASE WHEN $5::timestamptz IS NULL THEN newest_item_at
                             ELSE greatest(newest_item_at, $5::timestamptz) END,
       manifest = coalesce($6::jsonb, manifest),
       name = coalesce($7, name),
       icon_url = CASE WHEN $6::jsonb IS NULL THEN icon_url ELSE $8 END,
       fetch_status = $9,
       last_error = $10,
       error_count = CASE WHEN $9 = 'ok' THEN 0 ELSE error_count + 1 END
     WHERE id = $1`,
    [
      space.id,
      "etag" in s || "etagUrl" in s,
      s.etag ?? null,
      s.etagUrl ?? null,
      s.newestItemAt ? s.newestItemAt.toISOString() : null,
      s.manifest ? JSON.stringify(s.manifest) : null,
      name ?? null,
      actor?.iconUrl ?? null,
      status,
      status === "ok" ? null : (s.lastError ?? null),
    ],
  );
}

/** A 304: existing items stay; the space is healthy. */
export async function markNotModified(db: Db, spaceId: string): Promise<void> {
  await db.query(
    "UPDATE river.spaces SET fetch_status = 'ok', last_error = NULL, error_count = 0 WHERE id = $1",
    [spaceId],
  );
}

/** A failed refresh: a quiet note the Following page shows (spec F6 wording), never thrown. */
export async function recordFetchError(
  db: Db,
  spaceId: string,
  status: "error" | "blocked",
  message: string,
): Promise<void> {
  await db.query(
    "UPDATE river.spaces SET fetch_status = $2, last_error = $3, error_count = error_count + 1 WHERE id = $1",
    [spaceId, status, message.slice(0, 500)],
  );
}

/** Releases the claim (spec 4.5): always, in `finally`, with the database's clock. */
export async function releaseClaim(db: Db, spaceId: string): Promise<void> {
  await db.query(
    "UPDATE river.spaces SET fetch_lock_until = NULL, last_fetched_at = now() WHERE id = $1",
    [spaceId],
  );
}

/**
 * The exact claim statement of spec 4.5: a space is claimed only when nobody holds it and it was
 * not fetched in the last 120 s (which is also the fediverse minimum, spec 4.3).
 */
export const CLAIM_SQL =
  "UPDATE river.spaces SET fetch_lock_until = now() + interval '20 seconds' WHERE id = $1 " +
  "AND coalesce(fetch_lock_until, '-infinity') < now() " +
  "AND coalesce(last_fetched_at, '-infinity') < now() - interval '120 seconds' RETURNING id";

export async function claim(db: Db, spaceId: string): Promise<boolean> {
  const { rows } = await db.query(CLAIM_SQL, [spaceId]);
  return rows.length > 0;
}

/**
 * Stream bookkeeping (spec 4.2 "Stream end"): a row for every stream the fetch saw, titles from
 * the first Create civic:Process, ended streams, follows that end with them, and the final result,
 * which moves to a new candidate only when it is at least as new as the current one.
 */
export async function applyStreams(
  db: Db,
  spaceId: string,
  items: readonly NormalizedItem[],
  updates: readonly StreamUpdate[],
): Promise<void> {
  const keys = new Set<string>();
  for (const item of items) if (item.streamKey) keys.add(item.streamKey);
  for (const update of updates) keys.add(update.key);
  if (keys.size === 0) return;

  await db.query(
    `INSERT INTO river.streams (space_id, key) SELECT $1, k FROM unnest($2::text[]) AS k
     ON CONFLICT (space_id, key) DO NOTHING`,
    [spaceId, [...keys]],
  );

  for (const update of updates) {
    const { rows } = await db.query<{ id: string; ended: boolean }>(
      `UPDATE river.streams SET
         title = coalesce(title, $3),
         status = CASE WHEN $4 = 'ended' THEN 'ended' ELSE status END,
         ended_at = CASE WHEN $4 = 'ended' THEN coalesce(ended_at, $5::timestamptz) ELSE ended_at END
       WHERE space_id = $1 AND key = $2
       RETURNING id, status = 'ended' AS ended`,
      [spaceId, update.key, update.title ?? null, update.status ?? null, update.endedAt?.toISOString() ?? null],
    );
    const stream = rows[0];
    if (stream && update.status === "ended") {
      await db.query("SELECT river.mark_stream_follows_ended($1)", [stream.id]);
    }
    if (update.finalItemSourceId) await moveFinalResult(db, spaceId, update.key, update.finalItemSourceId);
  }
}

async function moveFinalResult(db: Db, spaceId: string, key: string, sourceId: string): Promise<void> {
  const { rows } = await db.query<{ id: string; source_id: string; published_at: Date; is_final_result: boolean }>(
    `SELECT id, source_id, published_at, is_final_result FROM river.items
      WHERE space_id = $1 AND stream_key = $2 AND (is_final_result OR source_id = $3)`,
    [spaceId, key, sourceId],
  );
  const candidate = rows.find((r) => r.source_id === sourceId);
  if (!candidate) return;
  const newestOther = rows
    .filter((r) => r.is_final_result && r.source_id !== sourceId)
    .reduce<Date | undefined>((best, r) => (!best || r.published_at > best ? r.published_at : best), undefined);
  const winner =
    newestOther && newestOther > candidate.published_at
      ? rows.find((r) => r.is_final_result && r.source_id !== sourceId && r.published_at.getTime() === newestOther.getTime())
      : candidate;
  if (!winner) return;
  await db.query(
    `UPDATE river.items SET is_final_result = (id = $3)
      WHERE space_id = $1 AND stream_key = $2 AND (is_final_result OR id = $3)`,
    [spaceId, key, winner.id],
  );
}

function isCheckViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === "23514" && e.constraint === constraint;
}

/**
 * Creates the space a follow box (or seed follow) resolved to, or finds it if another request
 * created it first (canonical_url is unique). Returns the stored row.
 */
export async function upsertSpace(db: Db, preview: SpacePreview): Promise<SpaceRow> {
  let inserted;
  try {
    inserted = await db.query<SpaceRow>(
      `INSERT INTO river.spaces (adapter, canonical_url, feed_url, actor_id, network, category, name, icon_url,
                                 home_url, manifest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (canonical_url) DO NOTHING
       RETURNING ${SPACE_COLUMNS}`,
      [
        preview.adapter,
        preview.canonicalUrl,
        preview.feedUrl ?? null,
        preview.actorId ?? null,
        preview.network ?? null,
        preview.category ?? null,
        spaceName(preview.name) ?? preview.canonicalUrl,
        preview.iconUrl ?? null,
        preview.homeUrl ?? null,
        JSON.stringify(preview.manifest ?? {}),
      ],
    );
  } catch (err) {
    // A database that doesn't know this adapter yet (the M12 migration hasn't run there): the
    // follow box says the kind isn't supported, instead of failing the request.
    if (isCheckViolation(err, "spaces_adapter_check")) {
      throw new AdapterError("not_supported", ADAPTER_MESSAGES.not_supported);
    }
    throw err;
  }
  if (inserted.rows[0]) return inserted.rows[0];
  const { rows } = await db.query<SpaceRow>(
    `SELECT ${SPACE_COLUMNS} FROM river.spaces WHERE canonical_url = $1`,
    [preview.canonicalUrl],
  );
  if (!rows[0]) throw new Error("space vanished between insert and select");
  return rows[0];
}
