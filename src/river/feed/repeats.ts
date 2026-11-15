// A hub followed two ways (civic-hub docs/FEDIVERSE.md "Following a hub both ways"): directly, as
// a civic space, and through the hub's own fediverse account, followed as a fediverse space. Every
// post from that account repeats something the hub's stream already carries, so the feed shows
// each item once: the hub's copy, which has more detail.
//
// The hub names its account in civic.json `features.fediverse` (kept in the hub space's manifest,
// src/river/adapters/civicHub/index.ts); the fediverse space is that account when its actor_id is
// the same IRI. Decided when the feed is read, from the reader's own follows: items are shared
// between readers, and someone who follows only the fediverse account still sees every post.
import type { Db } from "../../db/context.js";
import type { HubFediverseAccount } from "../adapters/civicHub/index.js";
import type { SpaceRow } from "./spaces.js";
import type { ReaderFollow } from "./visitor.js";

/**
 * Posts of `spaceId` (the hub's fediverse account) that repeat `hubSpaceId`. `contexts` undefined:
 * every post (the hub is followed whole). Otherwise only posts whose `context` is one of the
 * process IRIs the reader follows as single streams.
 */
export interface RepeatRule {
  spaceId: string;
  hubSpaceId: string;
  hubName: string;
  handle: string | null;
  contexts?: string[];
}

export function hubAccountOf(space: Pick<SpaceRow, "adapter" | "manifest">): HubFediverseAccount | undefined {
  if (space.adapter !== "civic_hub") return undefined;
  const fediverse = space.manifest?.fediverse as Partial<HubFediverseAccount> | undefined;
  return typeof fediverse?.actor === "string" ? { actor: fediverse.actor, ...(fediverse.handle ? { handle: fediverse.handle } : {}) } : undefined;
}

/** The repeat rules for a reader, from their follows and the stored space of each. */
export function repeatRules(follows: readonly ReaderFollow[], spaces: ReadonlyMap<string, SpaceRow>): RepeatRule[] {
  const fediverseByActor = new Map<string, SpaceRow>();
  for (const follow of follows) {
    const space = spaces.get(follow.spaceId);
    // Only a whole-space follow of the account: a single stream of a fediverse space isn't a thing.
    if (space?.adapter === "fediverse" && space.actor_id && !follow.streamKey) fediverseByActor.set(space.actor_id, space);
  }
  if (fediverseByActor.size === 0) return [];

  const rules: RepeatRule[] = [];
  const seen = new Set<string>();
  for (const follow of follows) {
    if (seen.has(follow.spaceId)) continue;
    const hub = spaces.get(follow.spaceId);
    const account = hub ? hubAccountOf(hub) : undefined;
    const fediverse = account ? fediverseByActor.get(account.actor) : undefined;
    if (!hub || !account || !fediverse) continue;
    seen.add(hub.id);
    const hubFollows = follows.filter((f) => f.spaceId === hub.id);
    const whole = hubFollows.some((f) => !f.streamKey);
    const handle = account.handle ?? handleOf(fediverse);
    rules.push({
      spaceId: fediverse.id,
      hubSpaceId: hub.id,
      hubName: hub.name,
      handle,
      ...(whole ? {} : { contexts: hubFollows.map((f) => f.streamKey!).filter(Boolean) }),
    });
  }
  return rules;
}

function handleOf(space: SpaceRow): string | null {
  const actor = space.manifest?.actor as { handle?: unknown } | undefined;
  return typeof actor?.handle === "string" ? actor.handle : null;
}

/** What the feed says in place of its empty message when the one source shown is a repeat. */
export function repeatNotice(rule: RepeatRule): string {
  const who = rule.handle ?? "This account";
  return rule.contexts
    ? `Posts from ${who} about the processes you follow on ${rule.hubName} show with the hub's own items.`
    : `Posts from ${who} repeat ${rule.hubName}, which you follow directly, so they show with the hub's own items.`;
}

/** A fediverse post's ActivityStreams `context` (a hub post's process IRI), a string or {id}. */
export const ITEM_CONTEXT_SQL =
  "coalesce(i.raw -> 'object' -> 'context' ->> 'id', i.raw -> 'object' ->> 'context', " +
  "i.raw -> 'context' ->> 'id', i.raw ->> 'context')";

/** The rules as the feed query's two parallel arrays: a null context hides every post. */
export function repeatParams(rules: readonly RepeatRule[]): { spaceIds: string[]; contexts: Array<string | null> } {
  const spaceIds: string[] = [];
  const contexts: Array<string | null> = [];
  for (const rule of rules) {
    for (const context of rule.contexts ?? [null]) {
      spaceIds.push(rule.spaceId);
      contexts.push(context);
    }
  }
  return { spaceIds, contexts };
}

/** On a hub card: the hub's fediverse account posted this item too. */
export interface AlsoOn {
  /** The account's handle, e.g. @floyd@floyd.civic.social. */
  handle: string | null;
  /** The fediverse space, for the Source filter. */
  spaceId: string;
}

/** How far apart a post without an activity link may be from the hub item it is folded into. */
export const CONTEXT_MATCH_MS = 24 * 60 * 60 * 1000;

interface PageRow {
  id: string;
  source_id: string;
  space_id: string;
  stream_key: string | null;
  published_at: Date;
}

interface RepeatRow {
  space_id: string;
  published_at: Date;
  context: string;
  links: unknown;
}

/**
 * The civic activity a hub post announces: its `url` Link with mediaType
 * application/activity+json (civic-hub docs/FEDIVERSE.md, step 2).
 */
export function announcedActivity(links: unknown): string | undefined {
  for (const link of Array.isArray(links) ? links : [links]) {
    if (!link || typeof link !== "object") continue;
    const { mediaType, href } = link as { mediaType?: unknown; href?: unknown };
    if (mediaType === "application/activity+json" && typeof href === "string") return href;
  }
  return undefined;
}

/**
 * Which hub items on a page the hub's account also posted: a post whose activity link is the hub
 * item's id, else (a post without one) the item of the same process published nearest to it,
 * within a day. Only posts the reader's rules hide are read, so a card never points at a post the
 * reader sees as well.
 */
export async function alsoOnFor(db: Db, rules: readonly RepeatRule[], page: readonly PageRow[]): Promise<Map<string, AlsoOn>> {
  const found = new Map<string, AlsoOn>();
  const byHub = new Map(rules.map((rule) => [rule.hubSpaceId, rule]));
  const hubRows = page.filter((row) => row.stream_key && byHub.has(row.space_id));
  if (hubRows.length === 0) return found;
  const contexts = [...new Set(hubRows.map((row) => row.stream_key!))];
  const { rows } = await db.query<RepeatRow>(
    `SELECT i.space_id, i.published_at, ${ITEM_CONTEXT_SQL} AS context,
            coalesce(i.raw -> 'object' -> 'url', i.raw -> 'url') AS links
       FROM river.items i
      WHERE NOT i.hidden
        AND i.space_id = ANY($1::uuid[])
        AND ${ITEM_CONTEXT_SQL} = ANY($2::text[])
      ORDER BY i.published_at DESC
      LIMIT 500`,
    [[...new Set([...byHub.values()].map((rule) => rule.spaceId))], contexts],
  );
  for (const post of rows) {
    const rule = [...byHub.values()].find((r) => r.spaceId === post.space_id && (!r.contexts || r.contexts.includes(post.context)));
    if (!rule) continue;
    const candidates = hubRows.filter((row) => row.space_id === rule.hubSpaceId && row.stream_key === post.context);
    const activity = announcedActivity(post.links);
    const match = activity
      ? candidates.find((row) => row.source_id === activity)
      : nearest(candidates, new Date(post.published_at).getTime());
    if (match) found.set(match.id, { handle: rule.handle, spaceId: rule.spaceId });
  }
  return found;
}

function nearest(rows: readonly PageRow[], at: number): PageRow | undefined {
  let best: PageRow | undefined;
  let bestGap = CONTEXT_MATCH_MS;
  for (const row of rows) {
    const gap = Math.abs(new Date(row.published_at).getTime() - at);
    if (gap <= bestGap) {
      best = row;
      bestGap = gap;
    }
  }
  return best;
}
