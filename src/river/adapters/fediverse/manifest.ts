// What the fediverse adapter keeps in spaces.manifest (spec 3.1, 4.3): the actor, cached for
// 24 hours, the server software from NodeInfo, and how the actor was read.
import { isObject, str } from "./activitypub.js";

export const ACTOR_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedActor {
  id: string;
  /** AS2 actor type (Person, Organization, Group, Service, Application). */
  type: string;
  name?: string;
  preferredUsername?: string;
  /** `@name@server`. */
  handle?: string;
  iconUrl?: string;
  /** The profile page. */
  url?: string;
  outbox?: string;
  /** ISO 8601. */
  fetchedAt: string;
  /** ISO 8601; refreshed by fetchNew once passed. */
  expiresAt: string;
}

export interface FediverseManifest {
  actor: CachedActor;
  /** NodeInfo `software`, when the server publishes it. */
  software?: { name: string; version?: string };
  /**
   * "activitypub" when the actor document was readable; "mastodon_api" when the server refused
   * unsigned actor reads and the profile came from Mastodon's REST API (spec 4.3 fallback).
   */
  via: "activitypub" | "mastodon_api";
  /** Mastodon's account id, for /api/v1/accounts/{id}/statuses. */
  mastodonAccountId?: string;
}

/** Reads a stored manifest defensively (it is jsonb another version of the code may have written). */
export function readManifest(raw: Record<string, unknown>): Partial<FediverseManifest> {
  const out: Partial<FediverseManifest> = {};
  const actor = raw.actor;
  if (isObject(actor) && str(actor.id) && str(actor.type)) {
    out.actor = {
      id: str(actor.id) as string,
      type: str(actor.type) as string,
      name: str(actor.name),
      preferredUsername: str(actor.preferredUsername),
      handle: str(actor.handle),
      iconUrl: str(actor.iconUrl),
      url: str(actor.url),
      outbox: str(actor.outbox),
      fetchedAt: str(actor.fetchedAt) ?? new Date(0).toISOString(),
      expiresAt: str(actor.expiresAt) ?? new Date(0).toISOString(),
    };
  }
  const software = raw.software;
  if (isObject(software) && str(software.name)) {
    out.software = { name: str(software.name) as string, version: str(software.version) };
  }
  if (raw.via === "activitypub" || raw.via === "mastodon_api") out.via = raw.via;
  const accountId = str(raw.mastodonAccountId);
  if (accountId) out.mastodonAccountId = accountId;
  return out;
}

/** The manifest as a plain jsonb value, without undefined fields. */
export function toManifestJson(manifest: FediverseManifest): Record<string, unknown> {
  return JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
}

export function isExpired(actor: CachedActor | undefined, now: Date): boolean {
  if (!actor) return true;
  const expires = Date.parse(actor.expiresAt);
  return Number.isNaN(expires) || expires <= now.getTime();
}
