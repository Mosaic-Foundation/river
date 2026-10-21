// What the follow box can hold for a fediverse space (spec F6, 4.3): a handle `@name@server` (or
// `acct:name@server`), or an https profile URL in one of the shapes fediverse software uses.
// A bare `name@server` is not taken, because it is indistinguishable from an email address and
// the River never receives those (CLAUDE.md constraint 7).

export type FediverseInput =
  | { kind: "handle"; name: string; server: string }
  | { kind: "url"; url: string; /** The account name when the path names one (`/@name`, `/users/name`). */ name?: string };

const NAME = /^[a-z0-9_][a-z0-9_.-]*$/i;

/**
 * Profile paths: Mastodon and most others (`/@name`, `/users/name`), Pixelfed, Lemmy and
 * Misskey-likes (`/u/name`, `/c/name`), PeerTube (`/a/name`, `/c/name`, `/accounts/name`,
 * `/video-channels/name`), WordPress (`/author/name`), Friendica (`/profile/name`).
 */
const PROFILE_PATH = /^\/(?:@|users\/|u\/|c\/|a\/|accounts\/|video-channels\/|author\/|profile\/)([^/@]+)\/?$/i;

/** A DNS hostname (with optional port), lowercased; undefined if it isn't one. */
function serverName(raw: string): string | undefined {
  try {
    const url = new URL(`https://${raw}`);
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return undefined;
    if (!url.hostname.includes(".")) return undefined;
    return url.host.toLowerCase();
  } catch {
    return undefined;
  }
}

export function parseInput(input: string): FediverseInput | undefined {
  const text = input.trim();
  const handle = /^(?:@|acct:)([^@\s]+)@([^@\s/]+)$/i.exec(text);
  if (handle) {
    const [, name, rawServer] = handle;
    const server = serverName(rawServer ?? "");
    if (!name || !NAME.test(name) || !server) return undefined;
    return { kind: "handle", name, server };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password) return undefined;
  const match = PROFILE_PATH.exec(url.pathname);
  if (!match) return undefined;
  const name = decodeURIComponent(match[1] ?? "");
  url.hash = "";
  return { kind: "url", url: url.toString(), ...(NAME.test(name) ? { name } : {}) };
}

/** The canonical handle, `@name@server`. */
export function formatHandle(name: string, server: string): string {
  return `@${name}@${server}`;
}
