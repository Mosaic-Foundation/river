// What the follow box can hold for a Bluesky account (ADR-009 item 2): a handle (`@name.bsky.social`
// or a custom-domain handle such as `@example.com`), a bare `name.bsky.social`, a bsky.app profile
// URL (by handle or DID), a DID (`did:plc:`, `did:web:`), or an `at://` URI naming an account.
//
// A bare custom domain (`example.com`) is not taken: it stays a web address for the hub and feed
// adapters. `@name@server` (two @) is a fediverse handle, never a Bluesky one.

export type BlueskyInput = { kind: "handle"; handle: string } | { kind: "did"; did: string };

/** The app the River links Bluesky posts and profiles to. */
export const BSKY_APP = "https://bsky.app";

const PLC = /^did:plc:[a-z2-7]{24}$/;
/** did:web with a host name only (no port, no path): the River reads `/.well-known/did.json`. */
const WEB = /^did:web:([a-z0-9.-]+)$/;

/** TLDs atproto handles may not use (atproto handle spec), plus names that can't be public. */
const DISALLOWED_TLDS = new Set(["alt", "arpa", "example", "internal", "invalid", "local", "localhost", "onion", "test"]);

/** A syntactically valid atproto handle, lowercased; undefined otherwise (atproto handle spec). */
export function normalizeHandle(raw: string): string | undefined {
  const handle = raw.trim().toLowerCase();
  if (handle.length === 0 || handle.length > 253) return undefined;
  const labels = handle.split(".");
  if (labels.length < 2) return undefined;
  for (const label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return undefined;
  }
  const tld = labels[labels.length - 1] as string;
  if (/^[0-9]/.test(tld) || DISALLOWED_TLDS.has(tld)) return undefined;
  return handle;
}

/** A DID the River can resolve (did:plc, or did:web on a host name), lowercased method part kept. */
export function normalizeDid(raw: string): string | undefined {
  const did = raw.trim();
  if (PLC.test(did)) return did;
  const web = WEB.exec(did.toLowerCase());
  if (web && normalizeHandle(web[1] as string) !== undefined) return did.toLowerCase();
  return undefined;
}

/** The domain a did:web names. */
export function didWebHost(did: string): string | undefined {
  return WEB.exec(did)?.[1];
}

function handleOrDid(raw: string): BlueskyInput | undefined {
  let text: string;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return undefined; // malformed percent-encoding: not an address
  }
  if (text.startsWith("did:")) {
    const did = normalizeDid(text);
    return did ? { kind: "did", did } : undefined;
  }
  const handle = normalizeHandle(text);
  return handle ? { kind: "handle", handle } : undefined;
}

export function parseInput(input: string): BlueskyInput | undefined {
  const text = input.trim();
  if (text === "" || /\s/.test(text)) return undefined;

  if (text.startsWith("did:")) return handleOrDid(text);

  if (text.startsWith("at://")) {
    // at://{did or handle}, an account; a record URI (at://did/collection/rkey) is not one.
    const authority = text.slice("at://".length).replace(/\/$/, "");
    if (authority.includes("/")) return undefined;
    return handleOrDid(authority);
  }

  if (text.startsWith("@")) {
    const rest = text.slice(1);
    if (rest.includes("@")) return undefined; // @name@server: fediverse
    const handle = normalizeHandle(rest);
    return handle ? { kind: "handle", handle } : undefined;
  }

  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return undefined;
    }
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase();
    if (host !== "bsky.app" && host !== "www.bsky.app") return undefined;
    const match = /^\/profile\/([^/]+)\/?$/.exec(url.pathname);
    return match ? handleOrDid(match[1] as string) : undefined;
  }

  // A bare handle only on bsky.social; any other bare domain is a web address.
  if (!text.includes("/") && !text.includes("@") && text.toLowerCase().endsWith(".bsky.social")) {
    const handle = normalizeHandle(text);
    return handle ? { kind: "handle", handle } : undefined;
  }
  return undefined;
}

/** `https://bsky.app/profile/{did}`: the profile page, by DID so it survives handle changes. */
export function profileUrl(didOrHandle: string): string {
  return `${BSKY_APP}/profile/${didOrHandle}`;
}

/** `at://{did}/app.bsky.feed.post/{rkey}` to `https://bsky.app/profile/{did}/post/{rkey}`. */
export function postUrl(atUri: string): string | undefined {
  const match = /^at:\/\/(did:[a-z0-9]+:[a-zA-Z0-9._:%-]+)\/app\.bsky\.feed\.post\/([a-zA-Z0-9._~:-]{1,512})$/.exec(atUri);
  if (!match) return undefined;
  return `${BSKY_APP}/profile/${match[1]}/post/${match[2]}`;
}

/** The canonical URL of a Bluesky space: `at://{did}` (ADR-009 item 3). */
export function canonicalUrlFor(did: string): string {
  return `at://${did}`;
}

/** The DID in a space's canonical URL, or undefined. */
export function didFromCanonical(canonical: string): string | undefined {
  return canonical.startsWith("at://") ? normalizeDid(canonical.slice("at://".length)) : undefined;
}

/** How the River writes a handle: `@name.bsky.social`. */
export function formatHandle(handle: string): string {
  return `@${handle}`;
}
