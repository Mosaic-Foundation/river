// What the Bluesky adapter keeps in spaces.manifest (ADR-009 item 3). `actor` has the fediverse
// adapter's CachedActor shape, so the refresh's name and icon update (applySpaceResult) and the
// follow lookup by handle work the same way; `id` is the DID, `handle` the current `@handle`.
import { ACTOR_TTL_MS, readManifest as readActorManifest, type CachedActor } from "../fediverse/manifest.js";
import { str } from "./http.js";
import { formatHandle, profileUrl } from "./input.js";

export interface BlueskyManifest {
  actor: CachedActor;
  /** The bio, plain text, as the follow preview showed it. */
  description?: string;
  /** The account's PDS from its DID document (informational; the River reads the AppView). */
  pds?: string;
}

export interface ProfileFacts {
  did: string;
  /** Verified handle, without `@`; undefined when the account has none that verifies. */
  handle?: string;
  displayName?: string;
  avatar?: string;
}

export function actorFrom(facts: ProfileFacts, now: Date): CachedActor {
  return {
    id: facts.did,
    type: "Person",
    ...(facts.displayName ? { name: facts.displayName } : {}),
    ...(facts.handle ? { preferredUsername: facts.handle, handle: formatHandle(facts.handle) } : {}),
    ...(facts.avatar ? { iconUrl: facts.avatar } : {}),
    url: profileUrl(facts.did),
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ACTOR_TTL_MS).toISOString(),
  };
}

export function readManifest(raw: Record<string, unknown>): Partial<BlueskyManifest> {
  const { actor } = readActorManifest(raw);
  const description = str(raw.description);
  const pds = str(raw.pds);
  return { ...(actor ? { actor } : {}), ...(description ? { description } : {}), ...(pds ? { pds } : {}) };
}

/** The manifest as a plain jsonb value, without undefined fields. */
export function toManifestJson(manifest: BlueskyManifest): Record<string, unknown> {
  return JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
}

/** True when the cached actor differs from what the feed just showed (name, handle, avatar). */
export function actorChanged(cached: CachedActor | undefined, fresh: CachedActor): boolean {
  if (!cached) return true;
  return cached.name !== fresh.name || cached.handle !== fresh.handle || cached.iconUrl !== fresh.iconUrl;
}
