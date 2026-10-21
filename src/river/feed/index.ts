// GET /api/feed (spec 4.5): refresh what the reader follows within the budget, then answer with
// what is stored. Visitors only in M5; M8 adds the member path (forAccount(), their follows,
// circles and stream rules) beside visitorView(), and the rest stays as it is.
import { forInstance } from "../../db/context.js";
import type { Instance } from "../instances.js";
import {
  decodeCursor,
  EMPTY_MESSAGE,
  FeedInputError,
  parseContentType,
  queryFeed,
  type FeedItem,
} from "./query.js";
import { refreshFollowed, type RefreshDeps, type RefreshReport } from "./refresh.js";
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
}

export async function visitorFeed(
  instance: Instance,
  params: FeedParams,
  deps: RefreshDeps = {},
): Promise<FeedResponse> {
  // Validate before any work, so a bad request costs nothing.
  const mode = parseMode(params.mode, instance);
  const kind = parseContentType(params.type);
  const cursor = decodeCursor(params.cursor);
  if (params.q !== undefined && params.q.length > 200) throw new FeedInputError("q", "Search is too long");
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
        instance: {
          name: instance.name,
          theme: instance.theme,
          modes: instance.modesEnabled,
          defaultMode: instance.defaultMode,
        },
        mode,
        circles: view.circles.map(({ id, name, color, role }) => ({ id, name, color, role })),
        items: page.items,
        nextCursor: page.nextCursor,
        empty,
        emptyMessage: empty ? EMPTY_MESSAGE : null,
        refresh: { claimed: refresh.claimed, pending: refresh.pending },
      };
    },
    deps.source,
  );
}
