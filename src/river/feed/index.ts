// GET /api/feed (spec 4.5): refresh what the reader follows within the budget, then answer with
// what is stored. Visitors read the instance's seed follows and default circles (visitorView);
// members their own rows under forAccount() (memberView), with their read state. Both go through
// the same scopeFor() and queryFeed().
import { forAccount, forInstance } from "../../db/context.js";
import { applyPendingSeeds, type Viewer } from "../accounts.js";
import type { Instance } from "../instances.js";
import {
  decodeCursor,
  EMPTY_MESSAGE,
  FeedInputError,
  parseContentType,
  markViewRead,
  queryFeed,
  type FeedItem,
} from "./query.js";
import { memberView } from "./member.js";
import { refreshFollowed, refreshSpaces, type RefreshDeps, type RefreshReport } from "./refresh.js";
import { findSpaces } from "./spaces.js";
import { parseMode, scopeFor, visitorView, type Mode } from "./visitor.js";

export { FeedInputError, EMPTY_MESSAGE } from "./query.js";

export interface FeedParams {
  mode?: string;
  circle?: string;
  type?: string;
  q?: string;
  cursor?: string;
}

export interface FeedResponse {
  instance: { name: string; theme: string; modes: string[]; defaultMode: string };
  mode: Mode;
  circles: Array<{ id: string; name: string; color: string | null; role: "civic" | null }>;
  items: FeedItem[];
  nextCursor: string | null;
  /** True when the first page has nothing: the UI shows `emptyMessage`. */
  empty: boolean;
  emptyMessage: string | null;
  refresh: Pick<RefreshReport, "claimed" | "pending">;
  /** Who is reading: null for a visitor (read state stays in the browser). */
  viewer: { did: string | null; displayName: string | null } | null;
}

function instanceSummary(instance: Instance): FeedResponse["instance"] {
  return {
    name: instance.name,
    theme: instance.theme,
    modes: instance.modesEnabled,
    defaultMode: instance.defaultMode,
  };
}

/** Validates the parameters every feed request shares, before any work. */
function parseCommon(instance: Instance, params: FeedParams) {
  const mode = parseMode(params.mode, instance);
  const kind = parseContentType(params.type);
  const cursor = decodeCursor(params.cursor);
  if (params.q !== undefined && params.q.length > 200) throw new FeedInputError("q", "Search is too long");
  return { mode, kind, cursor };
}

export async function visitorFeed(
  instance: Instance,
  params: FeedParams,
  deps: RefreshDeps = {},
): Promise<FeedResponse> {
  // Validate before any work, so a bad request costs nothing.
  const { mode, kind, cursor } = parseCommon(instance, params);
  const circle = params.circle;
  if (circle && circle.toLowerCase() !== "all" && !instance.defaultCircles.some((c) => c.name === circle)) {
    throw new FeedInputError("circle", `Unknown circle "${circle}"`);
  }

  const inputs = instance.seedFollows.map((f) => f.url);
  const circleInputs = instance.defaultCircles.flatMap((c) => c.members);
  // Paging reads what the first page's refresh stored; only the first page refreshes.
  const refresh = cursor
    ? { claimed: [], pending: [] }
    : await refreshFollowed(instance.id, inputs, deps);

  return forInstance(
    instance.id,
    async (db) => {
      const spaces = await findSpaces(db, [...new Set([...inputs, ...circleInputs])]);
      const view = visitorView(instance, spaces);
      const scope = scopeFor(view, mode, params.circle);
      const page = await queryFeed(db, scope, { kind, q: params.q, cursor });
      const empty = page.items.length === 0 && !cursor;
      return {
        instance: instanceSummary(instance),
        mode,
        circles: view.circles.map(({ id, name, color, role }) => ({ id, name, color, role })),
        items: page.items,
        nextCursor: page.nextCursor,
        empty,
        emptyMessage: empty ? EMPTY_MESSAGE : null,
        refresh: { claimed: refresh.claimed, pending: refresh.pending },
        viewer: null,
      };
    },
    deps.source,
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A member's circle parameter: "All", empty, or one of their circle ids. */
function parseMemberCircle(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "" || raw.toLowerCase() === "all") return undefined;
  if (!UUID.test(raw.toLowerCase())) throw new FeedInputError("circle", `Unknown circle "${raw}"`);
  return raw.toLowerCase();
}

/**
 * A member's feed: their follows and circles (seed copies made at sign-up, plus anything that was
 * waiting for its space), refreshed like a visitor's, with read state from river.read_state.
 */
export async function memberFeed(
  instance: Instance,
  viewer: Viewer,
  params: FeedParams,
  deps: RefreshDeps = {},
): Promise<FeedResponse> {
  const { mode, kind, cursor } = parseCommon(instance, params);
  const circle = parseMemberCircle(params.circle);
  const account = <T>(fn: Parameters<typeof forAccount<T>>[2]) =>
    forAccount(instance.id, viewer.accountId, fn, deps.source);

  let refresh: Pick<RefreshReport, "claimed" | "pending"> = { claimed: [], pending: [] };
  if (!cursor) {
    const { view, waiting } = await account(async (db) => ({
      waiting: await applyPendingSeeds(db),
      view: await memberView(db),
    }));
    const [stored, resolved] = await Promise.all([
      refreshSpaces(instance.id, view.spaces, deps),
      waiting.length > 0 ? refreshFollowed(instance.id, waiting, deps) : undefined,
    ]);
    refresh = {
      claimed: [...stored.claimed, ...(resolved?.claimed ?? [])],
      pending: [...stored.pending, ...(resolved?.pending ?? [])],
    };
  }

  return account(async (db) => {
    if (!cursor) await applyPendingSeeds(db);
    const view = await memberView(db);
    const scope = scopeFor(view, mode, circle);
    const page = await queryFeed(db, scope, { kind, q: params.q, cursor, withRead: true });
    const empty = page.items.length === 0 && !cursor;
    return {
      instance: instanceSummary(instance),
      mode,
      circles: view.circles.map(({ id, name, color, role }) => ({ id, name, color, role })),
      items: page.items,
      nextCursor: page.nextCursor,
      empty,
      emptyMessage: empty ? EMPTY_MESSAGE : null,
      refresh,
      viewer: { did: viewer.did, displayName: viewer.displayName },
    };
  });
}

/** "Mark all read" for a member's current view (mode, circle, type, search). */
export async function memberMarkAllRead(
  instance: Instance,
  viewer: Viewer,
  params: Omit<FeedParams, "cursor">,
  deps: Pick<RefreshDeps, "source"> = {},
): Promise<number> {
  const { mode, kind } = parseCommon(instance, { ...params, cursor: undefined });
  const circle = parseMemberCircle(params.circle);
  return forAccount(
    instance.id,
    viewer.accountId,
    async (db) => markViewRead(db, scopeFor(await memberView(db), mode, circle), { kind, q: params.q }),
    deps.source,
  );
}
