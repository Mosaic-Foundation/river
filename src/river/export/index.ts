// A member's export (spec 3.3, check 29): `GET /api/me/export` returns the member's follows,
// circles and preferences in the spec's shape, so they can take their River elsewhere.
//
// Everything is read inside the caller's forAccount() transaction, so row-level security limits it
// to the member's own rows (check 27). The River holds no email address and no private key
// (constraint 7), so neither can appear here; the document carries only the DID the member last
// signed in with, the canonical URLs of shared spaces, stream keys, circle names and colors, and
// preferences.
//
// Shape decisions (DECISIONS.md, M11):
//   - One `follows` entry per active rule (whole-space follow, stream follow, stream mute). A rule
//     whose stream has ended is left out: it no longer does anything and the daily job clears it.
//   - `url` is the space's canonical URL (a hub's origin, a fediverse actor id, a sample's URN),
//     which the follow box accepts; `stream_key` is the stream's `https://{host}/process/{id}`.
//   - `circles` on a follow names the member's circles that hold its space, in circle order.
//   - Seeds still waiting for their space (the `seed_pending` preference) are exported as the
//     follows they will become; that internal preference itself is not exported.
import type { Db } from "../../db/context.js";
import { SEED_PENDING_KEY, type PendingSeed } from "../accounts.js";

export const EXPORT_FORMAT = "mosaic-river-export";
export const EXPORT_VERSION = 1;

/** Preferences the River keeps for itself, never exported. */
const INTERNAL_PREFERENCES = new Set([SEED_PENDING_KEY]);

export interface ExportFollow {
  url: string;
  stream_key: string | null;
  rule: "follow" | "mute";
  circles: string[];
}

export interface ExportCircle {
  name: string;
  color: string | null;
  role: "civic" | null;
}

export interface RiverExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exported_at: string;
  did: string | null;
  follows: ExportFollow[];
  circles: ExportCircle[];
  preferences: Record<string, unknown>;
}

/** The member's rows the export is made from, as read by readExportRows(). */
export interface ExportRows {
  /** Active rules, oldest first. */
  rules: Array<{ space_id: string; url: string; stream_key: string | null; rule: "follow" | "mute" }>;
  /** Circles in the member's order. */
  circles: Array<{ id: string; name: string; color: string | null; role: "civic" | null }>;
  members: Array<{ circle_id: string; space_id: string }>;
  preferences: Array<{ key: string; value: unknown }>;
}

function isPendingSeed(value: unknown): value is PendingSeed {
  const v = value as PendingSeed;
  return (
    Boolean(v) &&
    typeof v.url === "string" &&
    typeof v.follow === "boolean" &&
    Array.isArray(v.circleIds) &&
    (v.stream_key === undefined || typeof v.stream_key === "string")
  );
}

/** Assembles the export document from the member's rows. Pure, so it is unit-tested alone. */
export function exportDocument(did: string | null, rows: ExportRows, exportedAt: Date): RiverExport {
  const circleOrder = new Map(rows.circles.map((c, i) => [c.id, { index: i, name: c.name }]));
  const namesOf = (circleIds: Iterable<string>): string[] =>
    [...new Set(circleIds)]
      .flatMap((id) => {
        const circle = circleOrder.get(id);
        return circle ? [circle] : [];
      })
      .sort((a, b) => a.index - b.index)
      .map((c) => c.name);

  const circleIdsBySpace = new Map<string, string[]>();
  for (const m of rows.members) circleIdsBySpace.set(m.space_id, [...(circleIdsBySpace.get(m.space_id) ?? []), m.circle_id]);

  const follows: ExportFollow[] = rows.rules.map((r) => ({
    url: r.url,
    stream_key: r.stream_key,
    rule: r.rule,
    circles: namesOf(circleIdsBySpace.get(r.space_id) ?? []),
  }));

  const preferences: Record<string, unknown> = {};
  for (const p of rows.preferences) {
    if (!INTERNAL_PREFERENCES.has(p.key)) {
      preferences[p.key] = p.value;
      continue;
    }
    if (p.key !== SEED_PENDING_KEY || !Array.isArray(p.value)) continue;
    for (const seed of p.value.filter(isPendingSeed)) {
      if (!seed.follow) continue;
      const streamKey = seed.stream_key ?? null;
      if (follows.some((f) => f.url === seed.url && f.stream_key === streamKey)) continue;
      follows.push({ url: seed.url, stream_key: streamKey, rule: "follow", circles: namesOf(seed.circleIds) });
    }
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: exportedAt.toISOString(),
    did,
    follows,
    circles: rows.circles.map((c) => ({ name: c.name, color: c.color, role: c.role })),
    preferences,
  };
}

/** Reads the member's own rows for the export. Runs inside forAccount(). */
export async function readExportRows(db: Db): Promise<ExportRows> {
  const { rows: rules } = await db.query<ExportRows["rules"][number]>(
    `SELECT f.space_id, s.canonical_url AS url, st.key AS stream_key, f.rule
       FROM river.follows f
       JOIN river.spaces s ON s.id = f.space_id
       LEFT JOIN river.streams st ON st.id = f.stream_id
      WHERE f.ended_at IS NULL
      ORDER BY f.created_at, f.id`,
  );
  const { rows: circles } = await db.query<ExportRows["circles"][number]>(
    "SELECT id, name, color, role FROM river.circles ORDER BY sort, lower(name), id",
  );
  const { rows: members } = await db.query<ExportRows["members"][number]>(
    "SELECT circle_id, space_id FROM river.circle_members ORDER BY circle_id, space_id",
  );
  const { rows: preferences } = await db.query<ExportRows["preferences"][number]>(
    "SELECT key, value FROM river.preferences ORDER BY key",
  );
  return { rules, circles, members, preferences };
}

/** The member's export. Runs inside forAccount(). */
export async function memberExport(db: Db, did: string | null, exportedAt: Date): Promise<RiverExport> {
  return exportDocument(did, await readExportRows(db), exportedAt);
}
