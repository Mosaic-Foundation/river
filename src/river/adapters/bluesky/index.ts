// The Bluesky adapter (ADR-009): atproto accounts by handle, bsky.app profile URL or DID, read
// unauthenticated from Bluesky's public AppView through the fetch guard the caller passes
// (ctx.guard, ADR-001). Spaces are keyed by DID (`at://{did}`); `spaces.adapter` is `atproto`.
import type { Adapter } from "../../../shared/items/index.js";
import { fetchNew } from "./fetch.js";
import { parseInput } from "./input.js";
import { resolve } from "./resolve.js";

export const blueskyAdapter: Adapter = {
  name: "atproto",
  accepts: (input) => parseInput(input) !== undefined,
  exclusive: true,
  resolve: (input, ctx) => resolve(input, ctx.guard, ctx.now),
  fetchNew,
};

export { APPVIEW, PLC_DIRECTORY, xrpcUrl } from "./http.js";
export { authorFeedUrl, MAX_AGE_MS, MAX_PAGES, PAGE_LIMIT } from "./fetch.js";
export {
  accountFrom,
  FOLLOWS_PAGE_LIMIT,
  followsUrl,
  MAX_FOLLOW_PAGES,
  previewForAccount,
  readFollows,
  type FollowedAccount,
  type FollowsListing,
} from "./follows.js";
export { readDidDocument, resolveHandle, resolveVerifiedHandle, type DidDocument } from "./identity.js";
export {
  BSKY_APP,
  canonicalUrlFor,
  didFromCanonical,
  formatHandle,
  normalizeDid,
  normalizeHandle,
  parseInput,
  postUrl,
  profileUrl,
  type BlueskyInput,
} from "./input.js";
export { readManifest, type BlueskyManifest } from "./manifest.js";
export {
  authorOf,
  embedParts,
  hidesFromVisitors,
  HIDDEN_LABELS,
  mapFeedEntry,
  NO_UNAUTHENTICATED,
  postHtml,
  readEmbed,
  type BlueskyRaw,
} from "./map.js";
export { getProfile, previewFrom } from "./resolve.js";
