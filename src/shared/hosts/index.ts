// Host lists: which hosts a list of entries covers (ADR-012 item 9; space-actions-1 2.1, 4 step 4,
// 5.2 and 7.2). Every check of a host against a configured or advertised list goes through here:
// a space's `did_hosts`, the River's SPACE_ACTION_HOSTS and Mosaic ID's
// IDENTITY_SPACE_ACTION_HOSTS.
//
// An entry matches its own host and any subdomain of it, on a dot boundary only:
//
//   civic.social  matches  civic.social, floyd.civic.social, a.b.civic.social
//                 never    evilcivic.social, civic.social.example.com, civic.social.
//
// Hosts are `hostname[:port]`, as a URL's `host` or a did:webvh's decoded host carries them
// (DECISIONS, "TRUSTED_DID_HOSTS names a host with its port"). An entry with a port matches only
// that port; an entry without one matches only hosts without one. Matching is case-insensitive.
// Anything that isn't a plain DNS name (a trailing dot, a wildcard, a leading dot, a path, an
// IPv6 literal, an empty label) matches nothing, as an entry or as a host. An IPv4 entry matches
// only that exact address. The suffix test is on whole labels, never on text.
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const PORT = /^[1-9][0-9]{0,4}$/;
const IPV4 = /^(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;

/** A host split into its lowercased labels and its port, or undefined if it isn't one. */
interface ParsedHost {
  labels: string[];
  port: string | undefined;
  ipv4: boolean;
}

function parseHost(value: unknown): ParsedHost | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 259) return undefined;
  const lower = value.toLowerCase();
  const colon = lower.indexOf(":");
  const hostname = colon === -1 ? lower : lower.slice(0, colon);
  const port = colon === -1 ? undefined : lower.slice(colon + 1);
  if (port !== undefined && (!PORT.test(port) || Number(port) > 65535)) return undefined;
  if (hostname.length === 0 || hostname.length > 253) return undefined;
  if (IPV4.test(hostname)) return { labels: hostname.split("."), port, ipv4: true };
  const labels = hostname.split(".");
  if (!labels.every((label) => LABEL.test(label))) return undefined;
  // A name made only of digits and dots that isn't a valid IPv4 address (999.1.1.1) is neither.
  if (labels.every((label) => /^[0-9]+$/.test(label))) return undefined;
  return { labels, port, ipv4: false };
}

/** True when `entry` is a usable host-list entry (`hostname[:port]`, no wildcard, no dot at either end). */
export function isHostEntry(entry: unknown): boolean {
  return parseHost(entry) !== undefined;
}

/** True when `host` is `entry` or a subdomain of it on a dot boundary, with the same port. */
export function hostMatches(host: unknown, entry: unknown): boolean {
  const h = parseHost(host);
  const e = parseHost(entry);
  if (!h || !e || h.port !== e.port) return false;
  if (e.ipv4 || h.ipv4) return h.ipv4 === e.ipv4 && h.labels.join(".") === e.labels.join(".");
  if (h.labels.length < e.labels.length) return false;
  const tail = h.labels.slice(h.labels.length - e.labels.length);
  return tail.every((label, i) => label === e.labels[i]);
}

/** True when some entry of `list` matches `host` (hostMatches). An empty list matches nothing. */
export function hostInList(host: unknown, list: readonly string[]): boolean {
  return list.some((entry) => hostMatches(host, entry));
}

/**
 * The host of an `https:` URL (with its port, if not 443) when some entry of `list` matches it;
 * undefined for any other scheme, a URL with credentials, or a host outside the list.
 */
export function httpsUrlHostInList(url: unknown, list: readonly string[]): string | undefined {
  if (typeof url !== "string") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") return undefined;
  return hostInList(parsed.host, list) ? parsed.host : undefined;
}

/**
 * A configured host list, lowercased, for a variable read at startup. Throws, naming the entry,
 * when an entry isn't a plain host: a mistyped list must stop the app, not quietly match nothing.
 */
export function parseHostList(name: string, entries: readonly string[]): string[] {
  return entries.map((entry) => {
    const trimmed = entry.trim();
    if (!isHostEntry(trimmed)) {
      throw new Error(`${name}: "${trimmed}" is not a host (hostname[:port], no wildcard, no leading or trailing dot)`);
    }
    return trimmed.toLowerCase();
  });
}
