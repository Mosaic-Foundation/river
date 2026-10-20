// Thin HTTP helpers — HTML, XML, PDF and JSON fetches with timeouts, for the
// sources a hub's admin configures (meeting-summary connectors, news sync).
//
// Every fetch goes through the SSRF guard (Audit 2, src/utils/ssrfGuard.ts):
// an admin-chosen URL cannot reach an internal address, by name, by redirect
// or by a DNS answer that changes between check and connect, and a body is
// read only up to a cap.

import { DEFAULT_MAX_BYTES, guardedFetch } from "./ssrfGuard.js";

const DEFAULT_TIMEOUT_MS = 15_000;
/** A meeting packet can be large; matches MAX_PDF_BYTES in the pipeline. */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

async function fetchWithTimeout(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await guardedFetch(url, { ...init, signal: controller.signal, maxBytes });
  } finally {
    clearTimeout(t);
  }
}

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      // Some Wix-hosted sites return a simplified response to plain
      // fetchers; a regular UA string keeps us on the normal HTML path.
      "user-agent":
        "Mozilla/5.0 (compatible; CivicHub/0.1; +https://civic.social)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`fetchHtml ${url} — ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Fetch an RSS / Atom feed (or any XML body) as a string. Same timeout
 * + non-http(s) guard as fetchHtml; only the accept header differs so
 * picky CDNs serve the XML variant cleanly.
 */
export async function fetchXml(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; CivicHub/0.1; +https://civic.social)",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
  });
  if (!res.ok) {
    throw new Error(`fetchXml ${url} — ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export async function fetchPdf(
  url: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; CivicHub/0.1; +https://civic.social)",
        accept: "application/pdf",
      },
    },
    30_000,
    MAX_PDF_BYTES,
  );
  if (!res.ok) {
    throw new Error(`fetchPdf ${url} — ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/pdf";
  return { bytes: new Uint8Array(ab), mime };
}

/**
 * Fetch a JSON document (GET by default, POST when `init` says so).
 *
 * Same timeout + non-http(s) guard as the other helpers. Exists so modules
 * that talk to a JSON API — e.g. the wix-cms meeting connector reading a
 * site's CMS collection — can stay dependency-injected rather than calling
 * `fetch` directly, per the module pluggability guardrail.
 *
 * Throws on a non-2xx response, including a snippet of the body: an API that
 * answers 403 with an explanation is far easier to diagnose than a bare status.
 */
export async function fetchJson(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<unknown> {
  const res = await fetchWithTimeout(
    url,
    {
      method: init.method ?? "GET",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; CivicHub/0.1; +https://civic.social)",
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      ...(init.body ? { body: init.body } : {}),
    },
    30_000,
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `fetchJson ${url} — ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
    );
  }
  return res.json();
}
