// "Import from Bluesky" (docs/spec/bluesky-1.md item 4, ADR-009 item 1): the accounts a Bluesky
// account follows, from app.bsky.graph.getFollows, 100 a page, at most MAX_FOLLOW_PAGES pages.
//
// The account whose follows are listed is resolved and verified like any follow (its handle must
// resolve to a DID whose document names it back). The accounts it follows are not each checked
// against their DID documents: that would be one PLC request per account. Each becomes a space
// keyed by its DID, with the handle the AppView reports (it writes "handle.invalid" for one that
// doesn't verify, which reads as none); the space's own refresh keeps it current.
import type { FetchGuard } from "../../../shared/fetch/index.js";
import { AdapterError, ADAPTER_MESSAGES, type SpacePreview } from "../../../shared/items/index.js";
import { toPlainText } from "../../../shared/sanitize/index.js";
import { get, httpsUrl, isObject, list, replyError, str, xrpcUrl, type Json } from "./http.js";
import { readDidDocument, resolveVerifiedHandle } from "./identity.js";
import { canonicalUrlFor, normalizeDid, normalizeHandle, parseInput, profileUrl } from "./input.js";
import { actorFrom, toManifestJson, type BlueskyManifest } from "./manifest.js";
import { hidesFromVisitors } from "./map.js";
import { getProfile } from "./resolve.js";

export const FOLLOWS_PAGE_LIMIT = 100;
/** At most 1,000 accounts per import (ADR-009 item 1). */
export const MAX_FOLLOW_PAGES = 10;

/** The getFollows URL for a DID (and a cursor). */
export function followsUrl(did: string, cursor?: string): string {
  return xrpcUrl("app.bsky.graph.getFollows", { actor: did, limit: FOLLOWS_PAGE_LIMIT, cursor });
}

export interface FollowedAccount {
  did: string;
  handle?: string;
  name: string;
  iconUrl?: string;
  description?: string;
}

export interface FollowsListing {
  /** The account whose follows these are. */
  account: FollowedAccount;
  accounts: FollowedAccount[];
  /** Accounts left out because they hide from signed-out readers. */
  skipped: number;
  /** True when the account follows more than MAX_FOLLOW_PAGES pages hold. */
  truncated: boolean;
}

/** A profile view (getProfile, getFollows' entries) as a followed account; undefined if unusable. */
export function accountFrom(profile: unknown): FollowedAccount | undefined {
  if (!isObject(profile)) return undefined;
  const did = normalizeDid(str(profile.did) ?? "");
  if (!did) return undefined;
  const handle = normalizeHandle(str(profile.handle) ?? "");
  const displayName = toPlainText(str(profile.displayName)).slice(0, 200);
  const iconUrl = httpsUrl(profile.avatar);
  const description = toPlainText(str(profile.description)).slice(0, 500);
  return {
    did,
    ...(handle ? { handle } : {}),
    name: displayName || handle || did,
    ...(iconUrl ? { iconUrl } : {}),
    ...(description ? { description } : {}),
  };
}

/** The space a followed account becomes: the same shape resolve() stores, keyed by DID. */
export function previewForAccount(account: FollowedAccount, now: Date): SpacePreview {
  const manifest: BlueskyManifest = {
    actor: actorFrom(
      {
        did: account.did,
        handle: account.handle,
        displayName: account.name !== account.handle && account.name !== account.did ? account.name : undefined,
        avatar: account.iconUrl,
      },
      now,
    ),
    ...(account.description ? { description: account.description } : {}),
  };
  return {
    adapter: "atproto",
    canonicalUrl: canonicalUrlFor(account.did),
    name: account.name,
    ...(account.iconUrl ? { iconUrl: account.iconUrl } : {}),
    ...(account.description ? { description: account.description } : {}),
    homeUrl: profileUrl(account.did),
    actorId: account.did,
    network: "bluesky",
    category: "person",
    manifest: toManifestJson(manifest),
  };
}

/** The verified DID and profile of the account typed in the import box. */
async function whose(guard: FetchGuard, input: string): Promise<{ did: string; profile: Json; handle?: string }> {
  const parsed = parseInput(input);
  if (!parsed) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  const doc =
    parsed.kind === "handle" ? await resolveVerifiedHandle(guard, parsed.handle) : await readDidDocument(guard, parsed.did);
  const profile = await getProfile(guard, doc.did);
  const fromProfile = normalizeHandle(str(profile.handle) ?? "");
  const handle = parsed.kind === "handle" ? parsed.handle : fromProfile && doc.handles.includes(fromProfile) ? fromProfile : undefined;
  return { did: doc.did, profile, ...(handle ? { handle } : {}) };
}

/**
 * Lists the accounts `input` (a handle, profile URL or DID) follows, in getFollows' order (most
 * recently followed first), each once. Throws the follow box's AdapterError when the account
 * can't be read; a page that fails after the first ends the listing there.
 */
export async function readFollows(guard: FetchGuard, input: string): Promise<FollowsListing> {
  const { did, profile, handle } = await whose(guard, input);
  const owner = accountFrom(profile);
  if (!owner) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  // The owner's handle is shown only when it verified; the AppView's is taken on its word.
  const { handle: _unverified, ...rest } = owner;
  const account: FollowedAccount = { ...rest, ...(handle ? { handle } : {}) };

  const seen = new Set<string>();
  const accounts: FollowedAccount[] = [];
  let skipped = 0;
  let cursor: string | undefined;
  let truncated = false;
  for (let page = 1; page <= MAX_FOLLOW_PAGES; page++) {
    const reply = await get(guard, followsUrl(did, cursor));
    if (reply.status !== 200 || !isObject(reply.body)) {
      if (page === 1) throw replyError(reply);
      break;
    }
    for (const entry of list(reply.body.follows)) {
      const followed = accountFrom(entry);
      if (!followed || seen.has(followed.did) || followed.did === did) continue;
      seen.add(followed.did);
      if (hidesFromVisitors(entry)) {
        skipped++;
        continue;
      }
      accounts.push(followed);
    }
    cursor = str(reply.body.cursor);
    if (!cursor || list(reply.body.follows).length === 0) break;
    if (page === MAX_FOLLOW_PAGES) truncated = true;
  }
  return { account, accounts, skipped, truncated };
}
