// The feed query (spec 4.5, F5, F9): newest-first items of the reader's scope, filtered by
// circle AND content type AND the mode's scope, with search and cursor pagination. Hidden items
// never appear.
//
// The scope is computed before the query (visitor.ts for visitors; M8/M9 add a member's scope from
// their follows, circles and stream rules), so this module only knows spaces and streams.
import type { Db } from "../../db/context.js";
import type { ItemEmbed, ItemKind } from "../../shared/items/index.js";
import { readEmbed } from "../adapters/bluesky/index.js";
import type { PluginItem } from "../plugins/api.js";
import type { SpaceRow } from "./spaces.js";

export const PAGE_SIZE = 30;
export const EMPTY_MESSAGE = "Nothing of that type in this circle yet.";

/** Content-type filter values (spec F5) and the item kind each one shows. */
export const CONTENT_TYPES: Record<string, ItemKind | undefined> = {
  all: undefined,
  posts: "post",
  articles: "article",
  podcasts: "podcast",
  videos: "video",
  photos: "photo",
  events: "event",
  civic: "civic",
};

/** Accepts `posts` or `post`, any case; undefined for All; throws for anything else. */
export function parseContentType(raw: string | undefined): ItemKind | undefined {
  if (raw === undefined || raw === "") return undefined;
  const value = raw.toLowerCase();
  if (value in CONTENT_TYPES) return CONTENT_TYPES[value];
  const plural = `${value}s`;
  if (plural in CONTENT_TYPES) return CONTENT_TYPES[plural];
  throw new FeedInputError("type", `Unknown content type "${raw}"`);
}

/**
 * Several content types at once (ui-revisions-1 item 2): `posts,videos`, each read as
 * parseContentType reads one. Undefined for All (empty, or any part "all").
 */
export function parseContentTypes(raw: string | undefined): ItemKind[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const kinds = new Set<ItemKind>();
  for (const part of raw.split(",").map((p) => p.trim())) {
    if (part === "") continue;
    const kind = parseContentType(part);
    if (kind === undefined) return undefined;
    kinds.add(kind);
  }
  return kinds.size > 0 ? [...kinds] : undefined;
}

/** Network filter values (ui-revisions-1 item 4; Bluesky, ADR-009) and the adapter each one shows. */
export const NETWORKS: Record<string, string> = {
  hubs: "civic_hub",
  fediverse: "fediverse",
  bluesky: "atproto",
};

/** `hubs,fediverse,bluesky`, any case: the adapters to show; undefined for all networks. */
export function parseNetworks(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const adapters = new Set<string>();
  for (const part of raw.split(",").map((p) => p.trim().toLowerCase())) {
    if (part === "") continue;
    const adapter = NETWORKS[part];
    if (!adapter) throw new FeedInputError("network", `Unknown network "${part}"`);
    adapters.add(adapter);
  }
  return adapters.size > 0 ? [...adapters] : undefined;
}

export class FeedInputError extends Error {
  constructor(
    readonly field: "mode" | "circle" | "type" | "network" | "q" | "cursor" | "item" | "source",
    message: string,
  ) {
    super(message);
    this.name = "FeedInputError";
  }
}

/**
 * What the reader may see before filters: whole spaces, single streams (of spaces not followed as
 * a whole), and muted streams, which stay hidden inside the whole spaces (spec F7: the most
 * specific rule wins).
 */
export interface FeedScope {
  spaceIds: string[];
  streams: Array<{ spaceId: string; key: string }>;
  /** Streams hidden inside `spaceIds` (a member's mutes). */
  mutedStreams?: Array<{ spaceId: string; key: string }>;
}

export interface FeedFilter {
  /** Any of these kinds; undefined for every kind. */
  kinds?: ItemKind[];
  /** Spaces of any of these adapters (networks); undefined for every network. */
  adapters?: string[];
  /** One item only (the reader view, ui-revisions-1 item 1). */
  itemId?: string;
  /** One source only: a space id (ui-revisions-11 item 2). */
  spaceId?: string;
  q?: string;
  cursor?: Cursor;
  limit?: number;
}

export interface Cursor {
  /** published_at as Postgres prints it (keeps microseconds). */
  at: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id])).toString("base64url");
}

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (raw === undefined || raw === "") return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      Array.isArray(value) &&
      typeof value[0] === "string" &&
      typeof value[1] === "string" &&
      !Number.isNaN(Date.parse(value[0])) &&
      UUID.test(value[1])
    ) {
      return { at: value[0], id: value[1] };
    }
  } catch {
    // fall through
  }
  throw new FeedInputError("cursor", "Invalid cursor");
}

/** One card's data (spec F1). */
export interface FeedItem {
  id: string;
  kind: ItemKind;
  publishedAt: string;
  title: string | null;
  summary: string | null;
  contentHtml: string | null;
  /** Null for samples (no "Open on" link). */
  url: string | null;
  streamKey: string | null;
  author: unknown;
  media: unknown[];
  boostOf: unknown;
  civic: unknown;
  isFinalResult: boolean;
  /** Members only: whether the member marked it read (server read state, spec F4). */
  read?: boolean;
  /** For events: when and where, when the source says (raw or raw.object: startTime, location.name). */
  event?: { startTime?: string; location?: string };
  /** A Bluesky post's link card or quoted post (ADR-009 item 4), from raw.embed. */
  embed?: ItemEmbed;
  /** Exactly one of Live (a real source) or Sample (seeded demo entry). */
  source: "live" | "sample";
  space: {
    id: string;
    name: string;
    iconUrl: string | null;
    category: string | null;
    adapter: string;
  };
}

interface ItemRow {
  id: string;
  kind: ItemKind;
  published_at: Date;
  cursor_at: string;
  title: string | null;
  stream_title: string | null;
  summary: string | null;
  content_html: string | null;
  url: string | null;
  stream_key: string | null;
  author: unknown;
  media: unknown[];
  boost_of: unknown;
  civic: unknown;
  is_final_result: boolean;
  event_start: string | null;
  event_location: string | null;
  embed: unknown;
  space_id: string;
  space_name: string;
  space_icon_url: string | null;
  space_category: string | null;
  space_adapter: string;
  read: boolean | null;
}

/** `%`, `_` and `\` are literal in a search for the source name. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The scope, kind, search and cursor conditions of the feed. The
 * caller's next bind parameter is `$${values.length + 1}`.
 */
function feedWhere(scope: FeedScope, filter: FeedFilter): { sql: string; values: unknown[] } {
  const q = filter.q?.trim() ? filter.q.trim().slice(0, 200) : null;
  const muted = scope.mutedStreams ?? [];
  return {
    sql: `NOT i.hidden
        AND ((i.space_id = ANY($1::uuid[])
              AND NOT EXISTS (
                    SELECT 1 FROM unnest($9::uuid[], $10::text[]) AS m(space_id, key)
                     WHERE m.space_id = i.space_id AND m.key = i.stream_key))
             OR (i.space_id, i.stream_key) IN (
                  SELECT * FROM unnest($2::uuid[], $3::text[])))
        AND ($4::text[] IS NULL OR i.kind = ANY($4::text[]))
        AND ($11::text[] IS NULL OR s.adapter = ANY($11::text[]))
        AND ($12::uuid IS NULL OR i.id = $12::uuid)
        AND ($13::uuid IS NULL OR i.space_id = $13::uuid)
        AND ($5::text IS NULL
             OR i.search @@ plainto_tsquery('simple', $5)
             OR s.name ILIKE $6)
        AND ($7::timestamptz IS NULL OR (i.published_at, i.id) < ($7::timestamptz, $8::uuid))`,
    values: [
      scope.spaceIds,
      scope.streams.map((st) => st.spaceId),
      scope.streams.map((st) => st.key),
      filter.kinds ?? null,
      q,
      q ? likePattern(q) : null,
      filter.cursor?.at ?? null,
      filter.cursor?.id ?? null,
      muted.map((m) => m.spaceId),
      muted.map((m) => m.key),
      filter.adapters ?? null,
      filter.itemId ?? null,
      filter.spaceId ?? null,
    ],
  };
}

export async function queryFeed(
  db: Db,
  scope: FeedScope,
  filter: FeedFilter & {
    /** A member's feed: each item says whether the member read it (river.read_state, own rows only). */
    withRead?: boolean;
  },
): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filter.limit ?? PAGE_SIZE, 1), 100);
  if (scope.spaceIds.length === 0 && scope.streams.length === 0) return { items: [], nextCursor: null };
  const where = feedWhere(scope, filter);
  const read = filter.withRead
    ? "EXISTS (SELECT 1 FROM river.read_state r WHERE r.item_id = i.id) AS read"
    : "NULL::boolean AS read";

  const { rows } = await db.query<ItemRow>(
    `SELECT i.id, i.kind, i.published_at, i.published_at::text AS cursor_at, i.title,
            st.title AS stream_title, i.summary, i.content_html, i.url, i.stream_key, i.author,
            i.media, i.boost_of, i.civic, i.is_final_result,
            CASE WHEN i.kind = 'event' THEN coalesce(i.raw ->> 'startTime', i.raw -> 'object' ->> 'startTime') END AS event_start,
            CASE WHEN i.kind = 'event' THEN coalesce(i.raw -> 'location' ->> 'name', i.raw -> 'object' -> 'location' ->> 'name') END AS event_location,
            CASE WHEN s.adapter = 'atproto' THEN i.raw -> 'embed' END AS embed,
            s.id AS space_id, s.name AS space_name, s.icon_url AS space_icon_url,
            s.category AS space_category, s.adapter AS space_adapter,
            ${read}
       FROM river.items i
       JOIN river.spaces s ON s.id = i.space_id
       LEFT JOIN river.streams st ON st.space_id = i.space_id AND st.key = i.stream_key
      WHERE ${where.sql}
      ORDER BY i.published_at DESC, i.id DESC
      LIMIT $${where.values.length + 1}`,
    [...where.values, limit + 1],
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toFeedItem),
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.cursor_at, id: last.id }) : null,
  };
}

/** A source the Source filter lists (ui-revisions-11 item 2). */
export interface SourceOption {
  id: string;
  name: string;
  /** The space's adapter: civic_hub, fediverse, atproto, rss or sample. */
  adapter: string;
}

/**
 * The sources a scope reads, by name: its followed spaces and the spaces of its followed streams
 * (whatever the circle or other filters, so the list doesn't shrink as filters change).
 */
export async function querySources(db: Db, scope: FeedScope): Promise<SourceOption[]> {
  const ids = [...new Set([...scope.spaceIds, ...scope.streams.map((s) => s.spaceId)])];
  if (ids.length === 0) return [];
  const { rows } = await db.query<SourceOption>(
    "SELECT id, name, adapter FROM river.spaces WHERE id = ANY($1::uuid[]) ORDER BY lower(name), id",
    [ids],
  );
  return rows;
}

/** Most items of a view that plugins read (newest first), and again most of its dated items. */
export const VIEW_ITEMS_LIMIT = 500;

const EVENT_START_SQL = "CASE WHEN i.kind = 'event' THEN coalesce(i.raw ->> 'startTime', i.raw -> 'object' ->> 'startTime') END";

interface ViewItemRow {
  id: string;
  kind: ItemKind;
  published_at: Date;
  title: string | null;
  url: string | null;
  stream_key: string | null;
  deadline: string | null;
  event_start: string | null;
  space_id: string;
  space_name: string;
  space_category: string | null;
  space_adapter: string;
}

async function selectViewItems(db: Db, where: { sql: string; values: unknown[] }, datedOnly: boolean): Promise<ViewItemRow[]> {
  const dated = datedOnly ? ` AND (i.civic ->> 'deadline' IS NOT NULL OR ${EVENT_START_SQL} IS NOT NULL)` : "";
  const { rows } = await db.query<ViewItemRow>(
    `SELECT i.id, i.kind, i.published_at, coalesce(i.title, st.title) AS title, i.url, i.stream_key,
            i.civic ->> 'deadline' AS deadline,
            ${EVENT_START_SQL} AS event_start,
            s.id AS space_id, s.name AS space_name, s.category AS space_category, s.adapter AS space_adapter
       FROM river.items i
       JOIN river.spaces s ON s.id = i.space_id
       LEFT JOIN river.streams st ON st.space_id = i.space_id AND st.key = i.stream_key
      WHERE ${where.sql}${dated}
      ORDER BY i.published_at DESC, i.id DESC
      LIMIT $${where.values.length + 1}`,
    [...where.values, VIEW_ITEMS_LIMIT],
  );
  return rows;
}

/**
 * The current view's items as plugins see them (src/river/plugins/api.ts PluginItem): the same
 * scope and filters as the feed, every page rather than one, newest first. That is the newest
 * VIEW_ITEMS_LIMIT items, plus up to as many of the newest that carry a date (a hub deadline or an
 * event's start), so a busy social feed can't push a vote announced last week out of Coming up.
 * Only what a card shows: no raw activity, no read state.
 */
export async function queryViewItems(db: Db, scope: FeedScope, filter: Omit<FeedFilter, "cursor" | "limit">): Promise<PluginItem[]> {
  if (scope.spaceIds.length === 0 && scope.streams.length === 0) return [];
  const where = feedWhere(scope, { ...filter, cursor: undefined });
  const newest = await selectViewItems(db, where, false);
  const seen = new Set(newest.map((row) => row.id));
  const dated = (await selectViewItems(db, where, true)).filter((row) => !seen.has(row.id));
  const rows = [...newest, ...dated].sort(
    (a, b) => b.published_at.getTime() - a.published_at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    publishedAt: row.published_at.toISOString(),
    title: row.title,
    url: row.url,
    streamKey: row.stream_key,
    deadline: row.deadline,
    eventStart: row.event_start,
    source: row.space_adapter === "sample" ? "sample" : "live",
    space: { id: row.space_id, name: row.space_name, category: row.space_category },
  }));
}

function toFeedItem(row: ItemRow): FeedItem {
  const event =
    row.kind === "event" && (row.event_start || row.event_location)
      ? {
          ...(row.event_start ? { startTime: row.event_start } : {}),
          ...(row.event_location ? { location: row.event_location } : {}),
        }
      : undefined;
  const embed = row.space_adapter === "atproto" ? readEmbed(row.embed) : undefined;
  return {
    id: row.id,
    kind: row.kind,
    publishedAt: row.published_at.toISOString(),
    // spec 4.2 Map: the object's name, else the stream's title.
    title: row.title ?? row.stream_title,
    summary: row.summary,
    contentHtml: row.content_html,
    url: row.url,
    streamKey: row.stream_key,
    author: row.author,
    media: Array.isArray(row.media) ? row.media : [],
    boostOf: row.boost_of,
    civic: row.civic,
    isFinalResult: row.is_final_result,
    ...(row.read === null ? {} : { read: row.read }),
    ...(event ? { event } : {}),
    ...(embed ? { embed } : {}),
    source: row.space_adapter === "sample" ? "sample" : "live",
    space: {
      id: row.space_id,
      name: row.space_name,
      iconUrl: row.space_icon_url,
      category: row.space_category,
      adapter: row.space_adapter,
    },
  };
}

/** Spaces as the scope builders need them. */
export type ScopeSpace = Pick<SpaceRow, "id" | "category" | "adapter">;
