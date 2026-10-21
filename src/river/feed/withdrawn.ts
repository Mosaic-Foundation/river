// Withdrawn processes (spec 4.2, check 33). A hub stops serving a process that is archived or sent
// back for review. During a hub space's refresh, each stream with no new item in 7 days that was
// not checked in the last day is probed once with `?context={key}&limit=1`; when the hub no
// longer serves it, that stream's items are hidden.
//
// probeStream().exists is the test, not the item count: hub pages are filtered after the limit,
// so a live stream can answer an empty page that still has `next` (DECISIONS, M3 spec question).
import type { ClientSource } from "../../db/context.js";
import { forInstance } from "../../db/context.js";
import type { FetchGuard } from "../../shared/fetch/index.js";
import { probeStream } from "../adapters/civicHub/index.js";
import type { SpaceRow } from "./spaces.js";

/** Probes per space per refresh, so one refresh never turns into dozens of requests. */
export const PROBES_PER_REFRESH = 5;

export interface WithdrawnContext {
  instanceId: string;
  guard: FetchGuard;
  now: Date;
  source?: ClientSource;
}

export interface WithdrawnReport {
  probed: string[];
  withdrawn: string[];
}

export async function checkWithdrawnStreams(space: SpaceRow, ctx: WithdrawnContext): Promise<WithdrawnReport> {
  const report: WithdrawnReport = { probed: [], withdrawn: [] };
  if (space.adapter !== "civic_hub" || !space.feed_url) return report;
  const feedUrl = space.feed_url;

  const { rows } = await forInstance(
    ctx.instanceId,
    (db) =>
      db.query<{ id: string; key: string }>(
        `SELECT s.id, s.key FROM river.streams s
          WHERE s.space_id = $1
            AND (s.last_checked_at IS NULL OR s.last_checked_at < $2::timestamptz - interval '1 day')
            AND NOT EXISTS (
              SELECT 1 FROM river.items i
               WHERE i.space_id = s.space_id AND i.stream_key = s.key
                 AND i.published_at > $2::timestamptz - interval '7 days')
            AND EXISTS (
              SELECT 1 FROM river.items i
               WHERE i.space_id = s.space_id AND i.stream_key = s.key AND NOT i.hidden)
          ORDER BY s.last_checked_at NULLS FIRST, s.key
          LIMIT $3`,
        [space.id, ctx.now.toISOString(), PROBES_PER_REFRESH],
      ),
    ctx.source,
  );

  for (const stream of rows) {
    let gone = false;
    try {
      gone = !(await probeStream(feedUrl, stream.key, { guard: ctx.guard })).exists;
    } catch {
      // Unreachable or refused: not evidence of anything. Checked again tomorrow.
    }
    report.probed.push(stream.key);
    if (gone) report.withdrawn.push(stream.key);
    await forInstance(
      ctx.instanceId,
      async (db) => {
        await db.query("UPDATE river.streams SET last_checked_at = $2 WHERE id = $1", [
          stream.id,
          ctx.now.toISOString(),
        ]);
        if (gone) {
          await db.query("UPDATE river.items SET hidden = true WHERE space_id = $1 AND stream_key = $2", [
            space.id,
            stream.key,
          ]);
        }
      },
      ctx.source,
    );
  }
  return report;
}
