// Resolve (spec 4.3): handle -> WebFinger -> actor; profile URL -> actor. NodeInfo names the
// network. When a Mastodon server refuses unsigned actor reads (mastodon.social does), the
// profile comes from its REST lookup instead, the same fallback 4.3 gives for the outbox.
import type { FetchGuard } from "../../../shared/fetch/index.js";
import { AdapterError, ADAPTER_MESSAGES, type SpaceCategory, type SpacePreview } from "../../../shared/items/index.js";
import {
  ACTIVITY_JSON,
  ACTOR_CATEGORY,
  JRD_JSON,
  LD_JSON_AS,
  PLAIN_JSON,
  asList,
  hostOf,
  httpsUrl,
  isObject,
  str,
  typeOf,
  urlOf,
  type AsObject,
} from "./activitypub.js";
import { getJson, objectBody, SERVER_ONLY_MESSAGE, statusError } from "./http.js";
import { formatHandle, parseInput } from "./input.js";
import { ACTOR_TTL_MS, toManifestJson, type CachedActor, type FediverseManifest } from "./manifest.js";
import { isPeerTube } from "./peertube.js";

export interface Software {
  name: string;
  version?: string;
}

/** `GET https://{server}/.well-known/webfinger?resource=acct:{name}@{server}`; the rel=self ActivityPub link. */
export async function webfinger(guard: FetchGuard, name: string, server: string): Promise<string> {
  const url = `https://${server}/.well-known/webfinger?resource=acct:${name}@${server}`;
  const res = await getJson(guard, url, JRD_JSON);
  if (res.status === 404 || res.status === 410) {
    throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  }
  if (res.status !== 200) throw statusError(res.status);
  const body = objectBody(res);
  const self = asList(body?.links).find(
    (link) =>
      isObject(link) &&
      link.rel === "self" &&
      (link.type === ACTIVITY_JSON || link.type === LD_JSON_AS) &&
      httpsUrl(link.href) !== undefined,
  );
  if (!isObject(self)) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  return self.href as string;
}

/**
 * NodeInfo (`/.well-known/nodeinfo`, then the newest 2.x schema it links). Best effort: a server
 * without it, or one that fails, just has no `network`. Never throws.
 */
export async function readNodeInfo(guard: FetchGuard, host: string): Promise<Software | undefined> {
  try {
    const wellKnown = objectBody(await getJson(guard, `https://${host}/.well-known/nodeinfo`, PLAIN_JSON));
    const links = asList(wellKnown?.links)
      .filter(isObject)
      .map((link) => ({
        version: /nodeinfo\.diaspora\.software\/ns\/schema\/(\d+\.\d+)$/.exec(str(link.rel) ?? "")?.[1],
        href: httpsUrl(link.href),
      }))
      .filter((l): l is { version: string; href: string } => l.version !== undefined && l.href !== undefined)
      .sort((a, b) => Number(b.version) - Number(a.version));
    const href = links[0]?.href;
    if (!href) return undefined;
    const doc = objectBody(await getJson(guard, href, PLAIN_JSON));
    const software = isObject(doc?.software) ? doc.software : undefined;
    const name = str(software?.name)?.toLowerCase();
    if (!name) return undefined;
    return { name, version: str(software?.version) };
  } catch {
    return undefined;
  }
}

export function isMastodon(software: Software | string | null | undefined): boolean {
  const name = typeof software === "string" ? software : software?.name;
  return name?.toLowerCase() === "mastodon";
}

/** An actor document: an id on the host it was served from, and an outbox. */
function asActor(body: unknown, servedFrom: string): AsObject | undefined {
  if (!isObject(body)) return undefined;
  const id = httpsUrl(body.id);
  if (!id || !httpsUrl(body.outbox)) return undefined;
  // An actor may only speak for its own host; anything else could impersonate another server.
  if (hostOf(id) !== hostOf(servedFrom)) return undefined;
  return body;
}

function cachedFromActor(actor: AsObject, handle: string | undefined, now: Date): CachedActor {
  const icon = asList(actor.icon).find(isObject);
  return {
    id: actor.id as string,
    type: typeOf(actor) ?? "Person",
    name: str(actor.name),
    preferredUsername: str(actor.preferredUsername),
    handle,
    iconUrl: icon ? urlOf(icon.url ?? icon) : undefined,
    url: urlOf(actor.url, "text/html"),
    outbox: httpsUrl(actor.outbox),
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ACTOR_TTL_MS).toISOString(),
  };
}

/** A Mastodon REST account (`/api/v1/accounts/lookup`). */
interface MastodonAccount {
  id: string;
  uri: string;
  url?: string;
  username?: string;
  display_name?: string;
  avatar?: string;
  bot?: boolean;
  group?: boolean;
}

function asMastodonAccount(body: unknown, host: string): MastodonAccount | undefined {
  if (!isObject(body)) return undefined;
  const id = str(body.id);
  const uri = httpsUrl(body.uri);
  if (!id || !uri || hostOf(uri) !== host) return undefined;
  return {
    id,
    uri,
    url: httpsUrl(body.url),
    username: str(body.username),
    display_name: str(body.display_name),
    avatar: httpsUrl(body.avatar),
    bot: body.bot === true,
    group: body.group === true,
  };
}

/** `GET /api/v1/accounts/lookup?acct=` (Mastodon's REST API; no sign-in needed). */
export async function mastodonLookup(guard: FetchGuard, host: string, acct: string): Promise<MastodonAccount> {
  const res = await getJson(guard, `https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`, PLAIN_JSON);
  if (res.status !== 200) throw statusError(res.status);
  const account = asMastodonAccount(res.body, host);
  if (!account) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  return account;
}

function cachedFromAccount(account: MastodonAccount, handle: string | undefined, now: Date): CachedActor {
  return {
    id: account.uri,
    // Mastodon's REST API has no actor type; group and bot accounts are Group and Service actors.
    type: account.group ? "Group" : account.bot ? "Service" : "Person",
    name: account.display_name,
    preferredUsername: account.username,
    handle,
    iconUrl: account.avatar,
    url: account.url,
    // Mastodon serves every account's outbox at {actor id}/outbox.
    outbox: `${account.uri}/outbox`,
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ACTOR_TTL_MS).toISOString(),
  };
}

/** The account name in an actor or profile URL (`/@name`, `/users/name`), if there is one. */
function nameFromUrl(url: string): string | undefined {
  try {
    return /^\/(?:@|users\/)([a-z0-9_][a-z0-9_.-]*)\/?$/i.exec(new URL(url).pathname)?.[1];
  } catch {
    return undefined;
  }
}

export interface ReadActorResult {
  actor: CachedActor;
  software?: Software;
  via: FediverseManifest["via"];
  mastodonAccountId?: string;
}

/**
 * Reads the actor at `actorUrl` (and NodeInfo for its host). On 401/403 from a Mastodon server it
 * uses the REST lookup; on any other server that means the space is server-only.
 */
export async function readActor(
  guard: FetchGuard,
  actorUrl: string,
  now: Date,
  opts: { handle?: string; name?: string } = {},
): Promise<ReadActorResult> {
  const res = await getJson(guard, actorUrl, ACTIVITY_JSON);
  const host = hostOf(res.url) ?? hostOf(actorUrl);
  if (!host) throw new AdapterError("refused", ADAPTER_MESSAGES.refused);

  if (res.status === 200) {
    const actor = asActor(res.body, res.url);
    if (!actor) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
    const software = await readNodeInfo(guard, host);
    const username = str(actor.preferredUsername);
    const handle = opts.handle ?? (username ? formatHandle(username, host) : undefined);
    return { actor: cachedFromActor(actor, handle, now), software, via: "activitypub" };
  }

  if (res.status === 401 || res.status === 403) {
    const software = await readNodeInfo(guard, host);
    const name = opts.name ?? nameFromUrl(actorUrl);
    if (!isMastodon(software) || !name) throw new AdapterError("server_only", SERVER_ONLY_MESSAGE);
    const account = await mastodonLookup(guard, host, name);
    const handle = opts.handle ?? formatHandle(account.username ?? name, host);
    return {
      actor: cachedFromAccount(account, handle, now),
      software,
      via: "mastodon_api",
      mastodonAccountId: account.id,
    };
  }

  throw statusError(res.status);
}

/** The preview for a read actor (spec F6): name, icon, kind. */
export function previewFrom(result: ReadActorResult): SpacePreview {
  const { actor, software } = result;
  const manifest: FediverseManifest = {
    actor,
    ...(software ? { software } : {}),
    via: result.via,
    ...(result.mastodonAccountId ? { mastodonAccountId: result.mastodonAccountId } : {}),
  };
  return {
    adapter: "fediverse",
    canonicalUrl: actor.id,
    name: actor.name ?? actor.preferredUsername ?? actor.handle ?? actor.id,
    iconUrl: actor.iconUrl,
    homeUrl: actor.url ?? actor.id,
    feedUrl: actor.outbox,
    actorId: actor.id,
    network: software?.name,
    category: categoryOf(actor.type, software?.name),
    manifest: toManifestJson(manifest),
  };
}

/** Spec 4.3's actor types, except that a PeerTube channel (a Group) is a `video` space (M12). */
function categoryOf(actorType: string, software: string | undefined): SpaceCategory {
  if (isPeerTube(software) && actorType === "Group") return "video";
  return ACTOR_CATEGORY[actorType] ?? "person";
}

export async function resolve(input: string, guard: FetchGuard, now: Date): Promise<SpacePreview> {
  const parsed = parseInput(input);
  if (!parsed) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);

  if (parsed.kind === "handle") {
    const actorUrl = await webfinger(guard, parsed.name, parsed.server);
    const handle = formatHandle(parsed.name, parsed.server);
    return previewFrom(await readActor(guard, actorUrl, now, { handle, name: parsed.name }));
  }

  try {
    return previewFrom(await readActor(guard, parsed.url, now, { name: parsed.name }));
  } catch (err) {
    // A profile page that answered with HTML instead of an actor: ask WebFinger for the account.
    if (!(err instanceof AdapterError) || err.reason !== "not_a_space" || !parsed.name) throw err;
    const host = hostOf(parsed.url);
    if (!host) throw err;
    const actorUrl = await webfinger(guard, parsed.name, host);
    return previewFrom(
      await readActor(guard, actorUrl, now, { handle: formatHandle(parsed.name, host), name: parsed.name }),
    );
  }
}
