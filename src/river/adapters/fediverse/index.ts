// The fediverse adapter (spec 4.3, ADR-003): ActivityPub accounts by handle or profile URL, read
// without signatures through the fetch guard the caller passes (ctx.guard, ADR-001).
import type { Adapter } from "../../../shared/items/index.js";
import { fetchNew } from "./fetch.js";
import { parseInput } from "./input.js";
import { resolve } from "./resolve.js";

export const fediverseAdapter: Adapter = {
  name: "fediverse",
  accepts: (input) => parseInput(input) !== undefined,
  resolve: (input, ctx) => resolve(input, ctx.guard, ctx.now),
  fetchNew,
};

export {
  BOOST_DEREFERENCE_LIMIT,
  createBoostBudget,
  dereferenceBoost,
  type BoostBudget,
  type DereferenceResult,
} from "./boosts.js";
export { MAX_PAGES, REST_LIMIT } from "./fetch.js";
export { SERVER_ONLY_MESSAGE, RATE_LIMITED_MESSAGE } from "./http.js";
export { formatHandle, parseInput, type FediverseInput } from "./input.js";
export { ACTOR_TTL_MS, readManifest, type CachedActor, type FediverseManifest } from "./manifest.js";
export { mapActivity, mapObject, mapStatus, type MapContext } from "./map.js";
export { isMastodon, readNodeInfo, webfinger } from "./resolve.js";
export { PUBLIC_IRIS, addressedToPublic } from "./activitypub.js";
