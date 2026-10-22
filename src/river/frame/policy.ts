// Whether a page's response lets the River show it in an iframe (ui-revisions-2 item 2, ADR-008).
// Reads only response headers, the way a browser decides: an enforced Content-Security-Policy
// with frame-ancestors decides on its own (X-Frame-Options is then ignored, CSP Level 3 §6.4.2);
// otherwise X-Frame-Options does. Where a browser would be lenient (ALLOW-FROM, which browsers
// ignore; a frame-ancestors source with a path) this answers no, so a doubtful page opens in the
// reader view instead of as a blank frame. Report-only policies and <meta> tags never block
// framing, so they're not read.

/** True when a page served with `headers` from `pageUrl` may be framed by a page at `ancestorOrigin`. */
export function framingAllowed(headers: Headers, pageUrl: string, ancestorOrigin: string): boolean {
  const page = new URL(pageUrl);
  const ancestor = new URL(ancestorOrigin);
  const ancestorLists = frameAncestorLists(headers.get("content-security-policy"));
  if (ancestorLists.length > 0) {
    // Every enforced policy must allow it.
    return ancestorLists.every((sources) => sources.some((source) => sourceMatches(source, ancestor, page)));
  }
  return xFrameOptionsAllows(headers.get("x-frame-options"));
}

/**
 * The frame-ancestors source lists of each policy in a (possibly comma-joined) CSP header. A
 * policy without the directive adds nothing; only a directive's first occurrence counts.
 */
export function frameAncestorLists(header: string | null): string[][] {
  if (!header) return [];
  const lists: string[][] = [];
  for (const policy of header.split(",")) {
    for (const directive of policy.split(";")) {
      const [name, ...sources] = directive.trim().split(/\s+/);
      if (name?.toLowerCase() === "frame-ancestors") {
        // 'none' alone leaves an empty list, which matches nothing; beside other sources it's ignored.
        lists.push(sources.filter((s) => s.toLowerCase() !== "'none'"));
        break;
      }
    }
  }
  return lists;
}

/** X-Frame-Options (HTML §7.1.1.1): absent or ALLOWALL allows; DENY, SAMEORIGIN and anything else refuse. */
function xFrameOptionsAllows(header: string | null): boolean {
  if (header === null) return true;
  const values = header
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return values.every((v) => v === "allowall");
}

const NETWORK_SCHEMES = new Set(["http:", "https:"]);
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

function portOf(url: URL): string {
  return url.port || DEFAULT_PORTS[url.protocol] || "";
}

/** A scheme in a source matches the ancestor's; http: also matches https: (CSP3 §6.7.2.8). */
function schemeMatches(sourceScheme: string, ancestorScheme: string): boolean {
  return sourceScheme === ancestorScheme || (sourceScheme === "http:" && ancestorScheme === "https:");
}

const HOST_SOURCE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\*|\d+))?(\/.*)?$/i;

/** CSP3 §6.7.2.5 "Does url match expression in origin with redirect count", for an ancestor's origin. */
export function sourceMatches(source: string, ancestor: URL, page: URL): boolean {
  const s = source.toLowerCase();
  if (s === "*") return NETWORK_SCHEMES.has(ancestor.protocol);
  if (s === "'self'") return ancestor.origin === page.origin;
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return schemeMatches(s, ancestor.protocol);
  if (s.startsWith("'")) return false;

  const m = HOST_SOURCE.exec(s);
  if (!m) return false;
  const [, scheme, host, port, path] = m;
  if (scheme) {
    if (!schemeMatches(`${scheme}:`, ancestor.protocol)) return false;
  } else if (!schemeMatches(page.protocol, ancestor.protocol)) {
    return false;
  }
  const ancestorHost = ancestor.hostname.toLowerCase();
  if (host === "*") {
    // A bare * host with a scheme or port; still a network origin only.
    if (!NETWORK_SCHEMES.has(ancestor.protocol)) return false;
  } else if (host!.startsWith("*.")) {
    if (!ancestorHost.endsWith(host!.slice(1))) return false;
  } else if (host !== ancestorHost) {
    return false;
  }
  if (port !== "*") {
    const wanted = port ?? DEFAULT_PORTS[scheme ? `${scheme}:` : ancestor.protocol];
    const have = portOf(ancestor);
    // http://host:80 also covers https://host:443 (the scheme upgrade above).
    const upgraded = scheme === "http" && wanted === "80" && ancestor.protocol === "https:" && have === "443";
    if (wanted !== have && !upgraded) return false;
  }
  // An origin's path is "/": a source path other than "/" can't match it.
  if (path && path !== "/") return false;
  return true;
}
