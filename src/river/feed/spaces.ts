// Stored spaces as the feed and the refresh read them, and how a followed name (what someone typed
// in the follow box, or an instance's seed follow) finds its stored space.
import type { Db } from "../../db/context.js";
import type { AdapterName, SpaceCategory, SpaceRecord } from "../../shared/items/index.js";
import { civicHubAdapter } from "../adapters/civicHub/index.js";
import { formatHandle, parseInput as parseFediverseInput } from "../adapters/fediverse/index.js";
import { parseHubInput } from "../adapters/civicHub/index.js";

export interface SpaceRow {
  id: string;
  adapter: AdapterName;
  canonical_url: string;
  feed_url: string | null;
  actor_id: string | null;
  network: string | null;
  category: SpaceCategory | null;
  name: string;
  icon_url: string | null;
  home_url: string | null;
  manifest: Record<string, unknown>;
  etag: string | null;
  etag_url: string | null;
  newest_item_at: Date | null;
  last_fetched_at: Date | null;
  fetch_lock_until: Date | null;
  fetch_status: "ok" | "error" | "blocked" | null;
  error_count: number;
  last_error: string | null;
}

export const SPACE_COLUMNS =
  "id, adapter, canonical_url, feed_url, actor_id, network, category, name, icon_url, home_url, manifest, " +
  "etag, etag_url, newest_item_at, last_fetched_at, fetch_lock_until, fetch_status, error_count, last_error";

/** What an adapter's fetchNew reads. */
export function toSpaceRecord(row: SpaceRow): SpaceRecord {
  return {
    id: row.id,
    adapter: row.adapter,
    canonicalUrl: row.canonical_url,
    feedUrl: row.feed_url,
    actorId: row.actor_id,
    network: row.network,
    manifest: row.manifest ?? {},
    etag: row.etag,
    etagUrl: row.etag_url,
    newestItemAt: row.newest_item_at,
  };
}

/** Sample spaces (spec 4.4) are followed by their URN and never fetched. */
export const SAMPLE_PREFIX = "urn:mosaic:sample:";

/**
 * How a followed name is found among stored spaces without a request: a sample by its URN, a hub
 * by its origin (the hub adapter's canonical URL), a fediverse handle by the handle the adapter
 * cached in the manifest, and a fediverse profile URL by the actor id or profile URL.
 */
export type SpaceKey =
  | { by: "canonical"; value: string }
  | { by: "handle"; value: string }
  | { by: "profile"; value: string };

export function spaceKeyFor(input: string): SpaceKey | undefined {
  const text = input.trim();
  if (text.startsWith(SAMPLE_PREFIX)) return { by: "canonical", value: text };
  if (civicHubAdapter.accepts(text)) {
    const url = parseHubInput(text);
    if (url) return { by: "canonical", value: `https://${url.host.toLowerCase()}` };
  }
  const fedi = parseFediverseInput(text);
  if (fedi?.kind === "handle") return { by: "handle", value: formatHandle(fedi.name, fedi.server).toLowerCase() };
  if (fedi?.kind === "url") return { by: "profile", value: fedi.url };
  return undefined;
}

/** Finds the stored space for each name; names with no space yet are missing from the map. */
export async function findSpaces(db: Db, inputs: readonly string[]): Promise<Map<string, SpaceRow>> {
  const keys = new Map<string, SpaceKey>();
  for (const input of inputs) {
    const key = spaceKeyFor(input);
    if (key) keys.set(input, key);
  }
  const canonical = [...keys.values()].filter((k) => k.by !== "handle").map((k) => k.value);
  const handles = [...keys.values()].filter((k) => k.by === "handle").map((k) => k.value);
  const found = new Map<string, SpaceRow>();
  if (keys.size === 0) return found;

  const { rows } = await db.query<SpaceRow & { handle: string | null }>(
    `SELECT ${SPACE_COLUMNS}, lower(manifest -> 'actor' ->> 'handle') AS handle
       FROM river.spaces
      WHERE canonical_url = ANY($1::text[])
         OR home_url = ANY($1::text[])
         OR (adapter = 'fediverse' AND lower(manifest -> 'actor' ->> 'handle') = ANY($2::text[]))`,
    [canonical, handles],
  );
  for (const [input, key] of keys) {
    const row = rows.find((r) =>
      key.by === "handle"
        ? r.adapter === "fediverse" && r.handle === key.value
        : r.canonical_url === key.value || (key.by === "profile" && r.home_url === key.value),
    );
    if (row) {
      const { handle: _handle, ...space } = row;
      found.set(input, space);
    }
  }
  return found;
}
