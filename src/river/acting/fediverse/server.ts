// Finding a member's fediverse server before linking (fediverse-posting-1.md item 1.2; ADR-011
// items 1 and 6). What the member typed (a handle or a profile URL) becomes an account name, the
// actor URL its WebFinger names, and the server: the host of that actor URL, which can differ from
// the handle's domain. Then NodeInfo says which software it runs, Mastodon's discovery document
// must list PKCE S256, and `/api/v2/instance` gives the character limit.
//
// Only these GETs, to the handle's host (WebFinger) and the actor's host (the rest), all through
// the guard given; none carries a credential. Every failure is a LinkError with the sentence the
// member sees, naming the server.
import { FetchError, type FetchGuard } from "../../../shared/fetch/index.js";
import { AdapterError } from "../../../shared/items/index.js";
import { asList, isObject, str } from "../../adapters/fediverse/activitypub.js";
import { formatHandle, parseInput } from "../../adapters/fediverse/input.js";
import { webfinger } from "../../adapters/fediverse/resolve.js";

export type Software = "mastodon" | "gotosocial";

/** The oldest version of each software the River links (ADR-011 item 1). */
export const MINIMUM_VERSIONS: Record<Software, [number, number]> = { mastodon: [4, 3], gotosocial: [0, 19] };

/** The scopes the River asks for, beyond the identity scope (item 1.4). Never `read`, `write` or `admin:*`. */
export const ACTING_SCOPES = ["write:statuses", "write:favourites", "write:follows", "read:follows", "read:search"] as const;

/** The identity scope per software: Mastodon's `profile`, GoToSocial's `read:accounts`. */
export const IDENTITY_SCOPES: Record<Software, string> = { mastodon: "profile", gotosocial: "read:accounts" };

/** Every scope the River asks a server of this software for, in the order item 1.4 lists them. */
export function scopesFor(software: Software): string[] {
  return [IDENTITY_SCOPES[software], ...ACTING_SCOPES];
}

const DEFAULT_MAX_CHARACTERS: Record<Software, number> = { mastodon: 500, gotosocial: 5000 };
const DEFAULT_RESERVED_PER_URL = 23;

export type LinkErrorCode =
  | "bad_input"
  | "not_found"
  | "unsupported_software"
  | "unsupported_version"
  | "unreachable"
  | "busy"
  | "registration_refused"
  | "too_many_links";

export class LinkError extends Error {
  constructor(
    readonly code: LinkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LinkError";
  }
}

export const BAD_INPUT_MESSAGE = "Type a handle like @ana@example.social, or the address of a profile page.";

export function unreachable(host: string): LinkError {
  return new LinkError("unreachable", `We couldn't reach ${host}. Try again in a few minutes.`);
}

export function busy(host: string): LinkError {
  return new LinkError("busy", `${host} is busy; try again in a few minutes.`);
}

/** The account the member named. */
export interface NamedAccount {
  /** `@name@domain`, as typed (a profile URL's host is its domain). */
  handle: string;
  name: string;
  /** The actor URL WebFinger gave. */
  actorUri: string;
  /** The actor URL's host: the server the River links with. */
  host: string;
}

export interface ServerInfo {
  host: string;
  software: Software;
  /** NodeInfo's version string, as the server gave it (at most 64 characters). */
  version: string;
  scopes: string[];
  maxCharacters: number;
  charactersReservedPerUrl: number;
}

/** Reads a handle or profile URL and finds its actor with WebFinger. */
export async function findAccount(guard: FetchGuard, input: string): Promise<NamedAccount> {
  const parsed = parseInput(input);
  let name: string;
  let domain: string;
  if (parsed?.kind === "handle") {
    name = parsed.name;
    domain = parsed.server;
  } else if (parsed?.kind === "url" && parsed.name !== undefined) {
    name = parsed.name;
    domain = new URL(parsed.url).host.toLowerCase();
  } else {
    throw new LinkError("bad_input", BAD_INPUT_MESSAGE);
  }
  let actorUri: string;
  try {
    actorUri = await webfinger(guard, name, domain);
  } catch (err) {
    if (err instanceof AdapterError && err.reason === "not_a_space") {
      throw new LinkError("not_found", `${domain} doesn't know ${formatHandle(name, domain)}. Check the handle.`);
    }
    throw unreachable(domain);
  }
  const host = new URL(actorUri).host.toLowerCase();
  return { handle: formatHandle(name, domain), name, actorUri, host };
}

/** GET a JSON object; undefined body for non-2xx or unreadable answers. Guard failures become LinkError. */
async function getObject(guard: FetchGuard, host: string, url: string): Promise<{ status: number; body?: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await guard.fetch(url, { headers: { accept: "application/json" } });
  } catch (err) {
    if (err instanceof FetchError && err.code === "retry_later") throw busy(host);
    throw unreachable(host);
  }
  if (res.status === 429) {
    await res.body?.cancel();
    throw busy(host);
  }
  if (res.status < 200 || res.status >= 300) {
    await res.body?.cancel();
    return { status: res.status };
  }
  try {
    const body: unknown = JSON.parse(await res.text());
    return { status: res.status, body: isObject(body) ? body : undefined };
  } catch {
    return { status: res.status };
  }
}

/** `major.minor` from a version string ("4.3.2", "4.4.0-nightly.2026", "0.19.1 git-abc"). */
export function parseVersion(version: string): [number, number] | undefined {
  const match = /^v?(\d{1,4})\.(\d{1,4})/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function atLeast(version: [number, number], minimum: [number, number]): boolean {
  return version[0] > minimum[0] || (version[0] === minimum[0] && version[1] >= minimum[1]);
}

const SOFTWARE_NAMES: Record<string, string> = {
  mastodon: "Mastodon",
  gotosocial: "GoToSocial",
  akkoma: "Akkoma",
  pleroma: "Pleroma",
  misskey: "Misskey",
  pixelfed: "Pixelfed",
  peertube: "PeerTube",
  friendica: "Friendica",
  lemmy: "Lemmy",
};

/** How a software's name reads in a message: known names as their projects write them, others as given (cut to 40). */
export function softwareLabel(name: string): string {
  return SOFTWARE_NAMES[name] ?? name.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 40);
}

/** NodeInfo's software name (lowercase) and version, or undefined when the server has none. */
async function nodeInfo(guard: FetchGuard, host: string): Promise<{ name: string; version: string } | undefined> {
  const wellKnown = await getObject(guard, host, `https://${host}/.well-known/nodeinfo`);
  const links = asList(wellKnown.body?.links)
    .filter(isObject)
    .map((link) => ({
      version: /nodeinfo\.diaspora\.software\/ns\/schema\/(\d+\.\d+)$/.exec(str(link.rel) ?? "")?.[1],
      href: str(link.href),
    }))
    .filter((l): l is { version: string; href: string } => l.version !== undefined && l.href !== undefined)
    .sort((a, b) => Number(b.version) - Number(a.version));
  const href = links[0]?.href;
  // The document must be on the same server: its answer decides what the River sends there.
  if (!href || !URL.canParse(href) || new URL(href).protocol !== "https:" || new URL(href).host.toLowerCase() !== host) {
    return undefined;
  }
  const doc = await getObject(guard, host, href);
  const software = isObject(doc.body?.software) ? doc.body.software : undefined;
  const name = str(software?.name)?.toLowerCase();
  if (!name) return undefined;
  return { name, version: (str(software?.version) ?? "").slice(0, 64) };
}

/**
 * Checks that the server runs software the River links with (item 1.2), and reads its limits.
 * Throws a LinkError the member can read otherwise.
 */
export async function checkServer(guard: FetchGuard, host: string): Promise<ServerInfo> {
  const info = await nodeInfo(guard, host);
  if (!info) throw new LinkError("unsupported_software", `The River can't tell which software ${host} runs, so it can't post through it yet.`);
  if (info.name !== "mastodon" && info.name !== "gotosocial") {
    throw new LinkError("unsupported_software", `The River can't post through ${softwareLabel(info.name)} yet.`);
  }
  const software: Software = info.name;
  const tooOld = new LinkError("unsupported_version", `The River can't post through this version of ${softwareLabel(software)} yet.`);
  const version = parseVersion(info.version);
  if (!version || !atLeast(version, MINIMUM_VERSIONS[software])) throw tooOld;

  const scopes = scopesFor(software);
  if (software === "mastodon") {
    // Mastodon 4.3+ lists PKCE in its discovery document; without it, the link is refused.
    const discovery = await getObject(guard, host, `https://${host}/.well-known/oauth-authorization-server`);
    const methods = asList(discovery.body?.code_challenge_methods_supported);
    if (!methods.includes("S256")) throw tooOld;
    const supported = discovery.body?.scopes_supported;
    if (Array.isArray(supported) && !scopes.every((s) => supported.includes(s))) throw tooOld;
  }

  const instance = await getObject(guard, host, `https://${host}/api/v2/instance`);
  const configuration = isObject(instance.body?.configuration) ? instance.body.configuration : undefined;
  const statuses = isObject(configuration?.statuses) ? configuration.statuses : undefined;
  return {
    host,
    software,
    version: info.version,
    scopes,
    maxCharacters: positiveInt(statuses?.max_characters) ?? DEFAULT_MAX_CHARACTERS[software],
    charactersReservedPerUrl: positiveInt(statuses?.characters_reserved_per_url) ?? DEFAULT_RESERVED_PER_URL,
  };
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000 ? value : undefined;
}
