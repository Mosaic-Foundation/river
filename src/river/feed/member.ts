// A member's River (spec 2 "Member", F4, F5, F9): their own follows and circles, read inside
// forAccount() so row-level security keeps every other member's rows out (check 27). The scope
// has the same shape as a visitor's (visitor.ts), so scopeFor() and queryFeed() serve both;
// member circles are named by id, visitor circles by name.
//
// M9 adds stream mutes, the Ended and Quiet rules and circle editing on top of these rows.
import type { Db } from "../../db/context.js";
import type { ReaderCircle, ReaderFollow, ReaderView } from "./visitor.js";
import { SPACE_COLUMNS, type SpaceRow } from "./spaces.js";

export interface MemberView extends ReaderView {
  /** Every followed space, for the refresh. */
  spaces: SpaceRow[];
}

const PREFIXED_SPACE_COLUMNS = SPACE_COLUMNS.split(", ")
  .map((column) => `s.${column}`)
  .join(", ");

/** The member's follows (rule follow) and circles, from their own rows. Runs inside forAccount(). */
export async function memberView(db: Db): Promise<MemberView> {
  const { rows: followRows } = await db.query<SpaceRow & { stream_key: string | null }>(
    `SELECT ${PREFIXED_SPACE_COLUMNS}, st.key AS stream_key
       FROM river.follows f
       JOIN river.spaces s ON s.id = f.space_id
       LEFT JOIN river.streams st ON st.id = f.stream_id
      WHERE f.rule = 'follow'
      ORDER BY f.created_at, f.id`,
  );
  const follows: ReaderFollow[] = [];
  const categories = new Map<string, string | null>();
  const spaces = new Map<string, SpaceRow>();
  for (const { stream_key: streamKey, ...space } of followRows) {
    categories.set(space.id, space.category);
    spaces.set(space.id, space);
    follows.push(streamKey ? { spaceId: space.id, streamKey } : { spaceId: space.id });
  }

  const { rows: circleRows } = await db.query<{
    id: string;
    name: string;
    color: string | null;
    role: "civic" | null;
    space_ids: string[];
  }>(
    `SELECT c.id, c.name, c.color, c.role,
            coalesce(array_agg(cm.space_id) FILTER (WHERE cm.space_id IS NOT NULL), '{}') AS space_ids
       FROM river.circles c
       LEFT JOIN river.circle_members cm ON cm.circle_id = c.id
      GROUP BY c.id
      ORDER BY c.sort, c.name, c.id`,
  );
  const circles: ReaderCircle[] = circleRows.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    role: c.role,
    spaceIds: c.space_ids,
  }));
  return { follows, circles, categories, spaces: [...spaces.values()] };
}
