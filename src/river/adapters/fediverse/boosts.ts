// Boosted objects are fetched during a fediverse refresh, at most 20 dereferences per source per
// refresh (spec 4.3; boostContent.ts does the filling). fetchNew makes one BoostBudget per refresh
// and passes it to every dereference in it, PeerTube's own videos included. Nothing is retried,
// and nothing is fetched past the budget.
import type { FetchGuard } from "../../../shared/fetch/index.js";
import { AdapterError, type BoostRef, type NormalizedItem } from "../../../shared/items/index.js";
import { ACTIVITY_JSON, addressedToPublic, hostOf, httpsUrl, isObject } from "./activitypub.js";
import { getJson } from "./http.js";
import { mapObject } from "./map.js";

export const BOOST_DEREFERENCE_LIMIT = 20;

export interface BoostBudget {
  /** Uses one dereference; false when none are left. */
  take(): boolean;
  remaining(): number;
}

export function createBoostBudget(limit: number = BOOST_DEREFERENCE_LIMIT): BoostBudget {
  let left = limit;
  return {
    take() {
      if (left <= 0) return false;
      left -= 1;
      return true;
    },
    remaining: () => left,
  };
}

export type DereferenceResult =
  | { ok: true; item: NormalizedItem }
  | {
      ok: false;
      /**
       * budget: this refresh already used its dereferences (nothing was fetched).
       * not_public: the object isn't addressed to the public. (A public reply is read: the
       *   booster chose to share it, so it isn't hidden the way an account's own replies are.)
       * unreadable: the server refused an unsigned read, or the answer wasn't a post from that host.
       * refused / unreachable: the fetch guard's answer, as in AdapterError.
       */
      reason: "budget" | "not_public" | "unreadable" | "refused" | "unreachable";
    };

/**
 * Fetches a boosted object (its IRI, with Accept: application/activity+json) and maps it to an
 * item keyed by the object's own id. Counts against `budget` before fetching.
 */
export async function dereferenceBoost(
  boost: BoostRef | string,
  ctx: { guard: FetchGuard; budget: BoostBudget; now?: Date },
): Promise<DereferenceResult> {
  const objectId = httpsUrl(typeof boost === "string" ? boost : boost.objectId);
  if (!objectId) return { ok: false, reason: "refused" };
  if (!ctx.budget.take()) return { ok: false, reason: "budget" };
  let res;
  try {
    res = await getJson(ctx.guard, objectId, ACTIVITY_JSON);
  } catch (err) {
    const refused = err instanceof AdapterError && err.reason === "refused";
    return { ok: false, reason: refused ? "refused" : "unreachable" };
  }
  if (res.status !== 200) return { ok: false, reason: "unreadable" };
  // The object must come from the host its id names, so one server can't speak for another.
  if (hostOf(res.url) !== hostOf(objectId)) return { ok: false, reason: "unreadable" };
  const item = mapObject(res.body, { now: ctx.now ?? new Date() });
  if (!item || hostOf(item.sourceId) !== hostOf(objectId)) return { ok: false, reason: "unreadable" };
  if (!isObject(res.body) || !addressedToPublic(res.body.to)) return { ok: false, reason: "not_public" };
  return { ok: true, item: { ...item, hidden: false } };
}
