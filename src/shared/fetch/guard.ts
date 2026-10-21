// The fetch guard (spec Appendix B, ADR-001): the one way River and identity-host code reach
// another host. Ported from the Civic Hub's ssrfGuard.ts (docs/reuse/civic-hub/), moved from
// node:http to an undici Dispatcher so tests can inject one, with the River's limits.
//
//   1. The address, not the name. Every hop's host is resolved and every address it resolves to is
//      checked (addresses.ts). Any blocked answer refuses the request; nothing is sent.
//   2. The address checked is the address connected to. The default Agent's `connect.lookup`
//      resolves, checks and hands the socket the one address it checked, so a DNS answer that
//      changes between the pre-check and the connection (rebinding) can't reach anything else.
//   3. Redirects by hand, at most 3, each one re-checked; `http:` refused at every hop.
//   4. Limits: 2 MB body, 6 s for the whole request including redirects and queueing, at most 2
//      requests in flight per host, and a host's Retry-After (on 429 or 503) honored by refusing
//      that host until then. No retries: the caller decides.
//
// Tests and replay mode inject a resolver and a Dispatcher (MockAgent). An injected resolver's
// answers are checked like any other, so no option lets a private address through.
import dns from "node:dns";
import net from "node:net";
import { Agent, type Dispatcher } from "undici";
import { bareHost, isBlockedHostname, isBlockedIp } from "./addresses.js";
import { FetchError } from "./errors.js";

export const USER_AGENT = "MosaicRiver/0.1 (+https://river.mosaic.social)";

export const LIMITS = {
  timeoutMs: 6_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  maxPerHost: 2,
  /** A Retry-After longer than this is treated as this. */
  maxRetryAfterMs: 60 * 60 * 1000,
} as const;

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Resolves a hostname to every address it has (like dns.lookup with all: true). */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true });

export interface FetchGuardOptions {
  resolver?: Resolver;
  /** Default: an Agent whose connections are pinned to checked addresses. */
  dispatcher?: Dispatcher;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  maxPerHost?: number;
  /** Clock for Retry-After, in ms since the epoch. */
  now?: () => number;
}

export interface GuardedRequest {
  method?: "GET" | "HEAD" | "POST";
  /** Added to the request; User-Agent is always the River's. */
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface FetchGuard {
  /** fetch() for URLs someone else chose. Returns a standard Response whose `url` is the final URL. */
  fetch(url: string, init?: GuardedRequest): Promise<Response>;
}

/** The `connect.lookup` that pins a socket to an address this module checked. */
export function pinnedLookup(resolver: Resolver) {
  return (
    hostname: string,
    options: { all?: boolean },
    callback: (err: NodeJS.ErrnoException | null, address: string | ResolvedAddress[], family?: number) => void,
  ): void => {
    checkedAddress(hostname, resolver).then(
      (first) => (options.all ? callback(null, [first]) : callback(null, first.address, first.family)),
      (err: unknown) => callback(err as NodeJS.ErrnoException, "", 0),
    );
  };
}

/** Resolves a name and returns its first address, or throws if any answer is blocked. */
async function checkedAddress(hostname: string, resolver: Resolver): Promise<ResolvedAddress> {
  const host = bareHost(hostname);
  if (isBlockedHostname(host)) throw blocked();
  let answers: ResolvedAddress[];
  try {
    answers = await resolver(host);
  } catch {
    throw new FetchError("unresolvable_host", "Could not resolve host");
  }
  const first = answers[0];
  if (first === undefined) throw new FetchError("unresolvable_host", "Could not resolve host");
  if (answers.some((a) => isBlockedIp(a.address))) throw blocked();
  return first;
}

function blocked(): FetchError {
  return new FetchError("blocked_address", "Blocked internal address");
}

/** Throws unless `raw` is an https URL without credentials. */
function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError("invalid_url", "Malformed URL");
  }
  if (url.protocol !== "https:") throw new FetchError("not_https", "Only https:// URLs are fetched");
  if (url.username || url.password) throw new FetchError("credentials", "URLs with credentials are not fetched");
  return url;
}

/** Throws unless the URL's host is a public address or a name that resolves only to public ones. */
async function checkHost(url: URL, resolver: Resolver): Promise<void> {
  const host = bareHost(url.hostname);
  if (host === "") throw new FetchError("invalid_url", "URL has no host");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw blocked();
    return;
  }
  await checkedAddress(host, resolver);
}

/** Seconds or an HTTP date; returns ms from `now`, or undefined if absent or unreadable. */
function retryAfterMs(header: string | null, now: number): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function toHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const one of value) headers.append(name, one);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

export function createFetchGuard(options: FetchGuardOptions = {}): FetchGuard {
  const resolver = options.resolver ?? systemResolver;
  const dispatcher = options.dispatcher ?? new Agent({ connect: { lookup: pinnedLookup(resolver) } });
  const timeoutMs = options.timeoutMs ?? LIMITS.timeoutMs;
  const maxBytes = options.maxBytes ?? LIMITS.maxBytes;
  const maxRedirects = options.maxRedirects ?? LIMITS.maxRedirects;
  const maxPerHost = options.maxPerHost ?? LIMITS.maxPerHost;
  const now = options.now ?? Date.now;

  const inFlight = new Map<string, number>();
  const queues = new Map<string, Array<() => void>>();
  const notBefore = new Map<string, number>();

  /** Waits for one of the host's slots; returns the function that frees it. */
  async function acquire(host: string, signal: AbortSignal): Promise<() => void> {
    if ((inFlight.get(host) ?? 0) >= maxPerHost) {
      await new Promise<void>((resolve, reject) => {
        const queue = queues.get(host) ?? [];
        queues.set(host, queue);
        const wake = () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          queue.splice(queue.indexOf(wake), 1);
          reject(signal.reason);
        };
        queue.push(wake);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    } else {
      inFlight.set(host, (inFlight.get(host) ?? 0) + 1);
    }
    let freed = false;
    return () => {
      if (freed) return;
      freed = true;
      // Hand the slot straight to the next waiter, or give it back.
      const next = queues.get(host)?.shift();
      if (next) next();
      else inFlight.set(host, (inFlight.get(host) ?? 1) - 1);
    };
  }

  async function readCapped(
    body: Dispatcher.ResponseData["body"],
    declared: number,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (Number.isFinite(declared) && declared > maxBytes) {
      body.destroy();
      throw new FetchError("too_large", `Response larger than ${maxBytes} bytes`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        body.destroy();
        throw new FetchError("too_large", `Response larger than ${maxBytes} bytes`);
      }
      chunks.push(chunk as Buffer);
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  async function run(raw: string, init: GuardedRequest, signal: AbortSignal): Promise<Response> {
    let current = checkUrl(raw);
    // The River names itself, and the host comes from the checked URL, in any letter case.
    const callerHeaders = Object.fromEntries(
      Object.entries(init.headers ?? {}).filter(([name]) => !["user-agent", "host"].includes(name.toLowerCase())),
    );
    let method = init.method ?? "GET";
    let body = init.body;
    for (let hop = 0; ; hop++) {
      await checkHost(current, resolver);
      const host = current.host.toLowerCase();
      const until = notBefore.get(host);
      if (until !== undefined) {
        if (now() < until) throw new FetchError("retry_later", "The host asked us to wait", until);
        notBefore.delete(host);
      }

      const release = await acquire(host, signal);
      let status: number;
      let headers: Headers;
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        const res = await dispatcher.request({
          origin: current.origin,
          path: current.pathname + current.search,
          method,
          headers: { ...callerHeaders, "user-agent": USER_AGENT },
          body,
          signal,
        });
        status = res.statusCode;
        headers = toHeaders(res.headers);
        bytes = await readCapped(res.body, Number(headers.get("content-length") ?? NaN));
      } finally {
        release();
      }

      if (status === 429 || status === 503) {
        const wait = retryAfterMs(headers.get("retry-after"), now());
        if (wait !== undefined && wait > 0) {
          notBefore.set(host, now() + Math.min(wait, LIMITS.maxRetryAfterMs));
        }
      }

      const location = headers.get("location");
      if (status >= 300 && status < 400 && location !== null) {
        if (hop >= maxRedirects) throw new FetchError("too_many_redirects", "Too many redirects");
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new FetchError("invalid_url", "Malformed redirect");
        }
        current = checkUrl(next.toString());
        // 303, and 301/302 after a POST, continue as a GET without the body.
        if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
        }
        continue;
      }

      const nullBody = status === 204 || status === 205 || status === 304 || method === "HEAD";
      const response = new Response(nullBody ? null : bytes, { status, headers });
      Object.defineProperty(response, "url", { value: current.toString() });
      return response;
    }
  }

  return {
    async fetch(url, init = {}) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
      try {
        return await run(url, init, signal);
      } catch (err) {
        if (err instanceof FetchError) throw err;
        if (timeout.aborted) throw new FetchError("timeout", `No answer within ${timeoutMs} ms`);
        if (init.signal?.aborted) throw init.signal.reason;
        throw fromTransport(err);
      }
    },
  };
}

/** Maps what undici or the pinned lookup threw to a FetchError, keeping the original as cause. */
function fromTransport(err: unknown): FetchError {
  const seen = new Set<unknown>();
  for (let e: unknown = err; e && !seen.has(e); e = (e as { cause?: unknown }).cause) {
    seen.add(e);
    if (e instanceof FetchError) return e;
    const code = (e as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return new FetchError("unresolvable_host", "Could not resolve host");
    }
    if (code === "UND_ERR_MOCK_NOT_MATCHED" || (e as Error).name === "MockNotMatchedError") {
      return new FetchError("no_fixture", "No recorded response for this request");
    }
  }
  const wrapped = new FetchError("network", "The request failed");
  (wrapped as { cause?: unknown }).cause = err;
  return wrapped;
}
