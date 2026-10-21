// Test-only: reads a DID log from the identity dev server on loopback over http (DECISIONS, M8).
//
// Locally and in CI the identity host runs at http://localhost:3001, so its DIDs are
// did:webvh:{SCID}:localhost%3A3001:u:{code} and their logs live on loopback over http. The fetch
// guard refuses both (https only; loopback is a blocked address), as it must in production, and
// it has no override (spec Appendix B). This module is the one narrow way around that for local
// runs: it exists beside the guard so undici stays inside src/shared/fetch/ (ADR-001), and it
// refuses to do anything unless
//
//   - TEST_DID_LOOPBACK=1, a test-only variable that env.ts refuses on Vercel, and
//   - the URL is plain http to localhost, 127.0.0.1 or [::1] with an explicit port, a path and
//     no credentials, query or fragment.
//
// The River's DID resolver calls it only for a DID whose host is in TRUSTED_DID_HOSTS and is a
// loopback name. No redirect is followed; the body is capped like the guard's.
import { request } from "undici";
import { env } from "../../config/env.js";
import { FetchError } from "./errors.js";
import { LIMITS, USER_AGENT } from "./guard.js";

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when `url` is a URL loopbackFetch would accept (whatever TEST_DID_LOOPBACK says). */
export function isLoopbackHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    LOOPBACK_NAMES.has(url.hostname) &&
    url.port !== "" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
}

/** GET over loopback http, for local runs and CI only. Throws FetchError otherwise. */
export async function loopbackFetch(raw: string, signal?: AbortSignal): Promise<Response> {
  if (!env.testDidLoopback) {
    throw new FetchError("not_https", "Only https:// URLs are fetched");
  }
  if (!isLoopbackHttpUrl(raw)) {
    throw new FetchError("blocked_address", "Only http://localhost:{port} is read in test mode");
  }
  const timeout = AbortSignal.timeout(LIMITS.timeoutMs);
  try {
    const res = await request(raw, {
      method: "GET",
      headers: { "user-agent": USER_AGENT, accept: "text/jsonl, application/jsonl, */*" },
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += (chunk as Buffer).length;
      if (size > LIMITS.maxBytes) {
        res.body.destroy();
        throw new FetchError("too_large", `Response larger than ${LIMITS.maxBytes} bytes`);
      }
      chunks.push(chunk as Buffer);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(res.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    return new Response(new Uint8Array(Buffer.concat(chunks)), { status: res.statusCode, headers });
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (timeout.aborted) throw new FetchError("timeout", `No answer within ${LIMITS.timeoutMs} ms`);
    throw new FetchError("network", "The request failed");
  }
}
