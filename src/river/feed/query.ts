// The feed query (spec 4.5, F5, F9): newest-first items of the reader's scope, filtered by
// circle AND content type AND the mode's scope, with search and cursor pagination. Hidden items
// never appear.
//
// The scope is computed before the query (visitor.ts for visitors; M8/M9 add a member's scope from
// their follows, circles and stream rules), so this module only knows spaces and streams.
import type { Db } from "../../db/context.js";
import type { ItemKind } from "../../shared/items/index.js";
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

export class FeedInputError extends Error {
  constructor(
    readonly field: "mode" | "circle" | "type" | "q" | "cursor",
    message: string,
  ) {
    super(message);
    this.name = "FeedInputError";
  }
}

/** What the reader may see before filters: whole spaces, and single streams of other spaces. */
export interface FeedScope {
  spaceIds: string[];
  streams: Array<{ spaceId: string; key: string }>;
}

export interface FeedFilter {
  kind?: ItemKind;
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
  /** For events: when and where, when the source says (raw or raw.object: startTime, location.name). */
  event?: { startTime?: string; location?: string };
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
  space_id: string;
  space_name: string;
  space_icon_url: string | null;
  space_category: string | null;
  space_adapter: string;
}

/** `%`, `_` and `\` are literal in a search for the source name. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function queryFeed(
  db: Db,
  scope: FeedScope,
  filter: FeedFilter,
): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filter.limit ?? PAGE_SIZE, 1), 100);
  if (scope.spaceIds.length === 0 && scope.streams.length === 0) return { items: [], nextCursor: null };
  const q = filter.q?.trim() ? filter.q.trim().slice(0, 200) : null;

  const { rows } = await db.query<ItemRow>(
    `SELECT i.id, i.kind, i.published_at, i.published_at::text AS cursor_at, i.title,
            st.title AS stream_title, i.summary, i.content_html, i.url, i.stream_key, i.author,
            i.media, i.boost_of, i.civic, i.is_final_result,
            CASE WHEN i.kind = 'event' THEN coalesce(i.raw ->> 'startTime', i.raw -> 'object' ->> 'startTime') END AS event_start,
            CASE WHEN i.kind = 'event' THEN coalesce(i.raw -> 'location' ->> 'name', i.raw -> 'object' -> 'location' ->> 'name') END AS event_location,
            s.id AS space_id, s.name AS space_name, s.icon_url AS space_icon_url,
            s.category AS space_category, s.adapter AS space_adapter
       FROM river.items i
       JOIN river.spaces s ON s.id = i.space_id
       LEFT JOIN river.streams st ON st.space_id = i.space_id AND st.key = i.stream_key
      WHERE NOT i.hidden
        AND (i.space_id = ANY($1::uuid[])
             OR (i.space_id, i.stream_key) IN (
                  SELECT * FROM unnest($2::uuid[], $3::text[])))
        AND ($4::text IS NULL OR i.kind = $4)
        AND ($5::text IS NULL
             OR i.search @@ plainto_tsquery('simple', $5)
             OR s.name ILIKE $6)
        AND ($7::timestamptz IS NULL OR (i.published_at, i.id) < ($7::timestamptz, $8::uuid))
      ORDER BY i.published_at DESC, i.id DESC
      LIMIT $9`,
    [
      scope.spaceIds,
      scope.streams.map((s) => s.spaceId),
      scope.streams.map((s) => s.key),
      filter.kind ?? null,
      q,
      q ? likePattern(q) : null,
      filter.cursor?.at ?? null,
      filter.cursor?.id ?? null,
      limit + 1,
    ],
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toFeedItem),
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.cursor_at, id: last.id }) : null,
  };
}

function toFeedItem(row: ItemRow): FeedItem {
  const event =
    row.kind === "event" && (row.event_start || row.event_location)
      ? {
          ...(row.event_start ? { startTime: row.event_start } : {}),
          ...(row.event_location ? { location: row.event_location } : {}),
        }
      : undefined;
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
    ...(event ? { event } : {}),
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
