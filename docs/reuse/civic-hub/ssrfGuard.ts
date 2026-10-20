// SSRF guard for every server-side fetch of a URL someone other than the
// platform chose: a link a resident pastes (link previews), and the sources a
// hub's admin configures (meeting-summary connectors, news sync, the hub's
// Polis). Hardened in Audit 2 (2026-10-11).
//
// THREE THINGS, and why each:
//   1. The address, not the name. A host is resolved and every address it
//      resolves to is checked against the ranges below (loopback, private,
//      link-local and cloud metadata, carrier NAT, multicast, reserved, and
//      the IPv6 forms that carry an IPv4 address inside: mapped ::ffff:,
//      compatible ::a.b.c.d, NAT64 64:ff9b::, 6to4 2002::, Teredo 2001::).
//   2. The address we checked is the address we connect to. guardedFetch
//      connects through node:http with its own `lookup`, which resolves,
//      checks and hands that one address to the socket. Before this the check
//      resolved the name, then fetch() resolved it again, and a name whose DNS
//      answer changed in between (rebinding) reached whatever it pointed to
//      the second time. Redirects are followed by hand, each hop checked.
//   3. A size cap. A response body is read up to `maxBytes` and the request
//      is dropped beyond it, so a source cannot fill the function's memory.
//
// Local development may reach private addresses (a Polis on localhost) only
// with CIVIC_SSRF_ALLOW_PRIVATE=true, which production refuses
// (src/config/devFlags.ts).

import { ValidationError } from "../errors/index.js";
import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { privateFetchAllowed } from "../config/devFlags.js";

const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  BLOCKED.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::", 96], // IPv4-compatible ::a.b.c.d (deprecated, never public)
  // IPv4-mapped (::ffff:a.b.c.d, ::ffff:7f00:1) needs no entry: BlockList
  // checks a mapped address against the IPv4 ranges above. (Adding
  // ::ffff:0:0/96 here would block every IPv4 address: BlockList treats an
  // IPv4 address as its mapped form.)
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  BLOCKED.addSubnet(addr, prefix, "ipv6");
}

/** True if an IP literal (v4 or v6) is in a range we must never fetch. */
export function isBlockedIp(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0]!; // brackets, zone id
  if (net.isIPv4(bare)) return BLOCKED.check(bare, "ipv4");
  if (net.isIPv6(bare)) return BLOCKED.check(bare, "ipv6");
  return true; // not an address at all: fail closed
}

function checkUrl(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new ValidationError("Malformed URL.", "invalid_url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ValidationError("Only http:// and https:// URLs are allowed.", "invalid_url");
  }
  if (u.username || u.password) throw new ValidationError("URLs with a user name or password are not fetched.", "invalid_url");
  return u;
}

/**
 * Throw unless `rawUrl` is http(s) and its host resolves only to public IPs.
 * A pre-check, for an answer before anything is sent; guardedFetch checks the
 * address it actually connects to, which is what makes it safe.
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  const u = checkUrl(rawUrl);
  if (privateFetchAllowed()) return;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new ValidationError("Blocked internal address.", "blocked_address");
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new ValidationError("Could not resolve host.", "unresolvable_host");
  }
  if (addrs.length === 0) throw new ValidationError("Could not resolve host.", "unresolvable_host");
  for (const { address } of addrs) {
    if (isBlockedIp(address)) throw new ValidationError("Blocked internal address.", "blocked_address");
  }
}

/**
 * node:http's `lookup` for a guarded connection: resolve, refuse if any
 * answer is internal, and connect to the first answer, the one checked.
 */
function guardedLookup(
  hostname: string,
  options: { family?: number; all?: boolean },
  callback: (err: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void,
): void {
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return callback(err, "", 0);
    const list = addrs as Array<{ address: string; family: number }>;
    if (list.length === 0) return callback(new Error("Could not resolve host."), "", 0);
    if (!privateFetchAllowed() && list.some((a) => isBlockedIp(a.address))) {
      return callback(Object.assign(new Error("Blocked internal address."), { code: "ESSRF" }), "", 0);
    }
    const first = list[0]!;
    if (options.all) return callback(null, [first]);
    callback(null, first.address, first.family);
  });
}

export interface GuardedFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Largest body read, in bytes. Default 5 MB. */
  maxBytes?: number;
  /** Redirects followed, each one checked. Default 5. */
  maxRedirects?: number;
  /** "manual" returns a 3xx as it is, for a caller that follows its own. */
  redirect?: "follow" | "manual";
}

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** The body was larger than the caller allows. */
export class ResponseTooLargeError extends ValidationError {
  constructor(_url: string, maxBytes: number) {
    super(`That page is larger than ${Math.round(maxBytes / 1024)} KB, so it was not read.`, "response_too_large");
  }
}

interface RawResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: Buffer;
}

function requestOnce(url: URL, init: GuardedFetchInit, maxBytes: number): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && !privateFetchAllowed() && isBlockedIp(host)) {
      reject(new ValidationError("Blocked internal address.", "blocked_address"));
      return;
    }
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: init.method ?? "GET",
        headers: {
          ...(init.headers ?? {}),
          ...(init.body !== undefined ? { "content-length": String(Buffer.byteLength(init.body)) } : {}),
        },
        lookup: guardedLookup as unknown as typeof dnsLookup,
        signal: init.signal,
      },
      (res) => {
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          reject(new ResponseTooLargeError(url.toString(), maxBytes));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new ResponseTooLargeError(url.toString(), maxBytes));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) for (const one of v) headers.append(k, one);
            else if (v !== undefined) headers.set(k, String(v));
          }
          resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", headers, body: Buffer.concat(chunks) });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

/**
 * fetch(), for URLs someone else chose: every hop's address checked and
 * pinned, redirects followed by hand, the body capped. Returns a standard
 * Response (its `url` is the final URL), so callers keep fetch's shape.
 */
export async function guardedFetch(rawUrl: string, init: GuardedFetchInit = {}): Promise<Response> {
  const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = init.maxRedirects ?? 5;
  let current = checkUrl(rawUrl);
  let method = init.method ?? "GET";
  let body = init.body;
  for (let hop = 0; ; hop++) {
    const raw = await requestOnce(current, { ...init, method, body }, maxBytes);
    const location = raw.headers.get("location");
    if (init.redirect !== "manual" && raw.status >= 300 && raw.status < 400 && location) {
      if (hop >= maxRedirects) throw new ValidationError("That link redirects too many times.", "too_many_redirects");
      current = checkUrl(new URL(location, current).toString());
      // 303, and 301/302 after a POST, continue as a GET without the body.
      if (raw.status === 303 || ((raw.status === 301 || raw.status === 302) && method !== "GET" && method !== "HEAD")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    const nullBody = raw.status === 204 || raw.status === 205 || raw.status === 304 || method === "HEAD";
    const res = new Response(nullBody ? null : new Uint8Array(raw.body), {
      status: raw.status,
      statusText: raw.statusText,
      headers: raw.headers,
    });
    Object.defineProperty(res, "url", { value: current.toString() });
    return res;
  }
}
