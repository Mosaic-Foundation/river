// Recorded responses (spec 6): the file format, the writer recorders use, and replay.
//
// One JSON file per request at tests/fixtures/http/<host>/<slug>.json:
//   { "url": "https://…", "method": "GET", "requestHeaders": { "if-none-match": "…" }?,
//     "status": 200, "headers": { "content-type": "…" }, "body": "…" }
// `requestHeaders` is optional; when present, the fixture answers only requests carrying those
// headers (a 304 for If-None-Match, say). Bodies are text.
//
// Replay (FETCH_FIXTURES_DIR, local runs and CI only, refused on Vercel) runs the real guard with
// a MockAgent built from the files and a resolver that knows only the recorded hosts, so URL and
// address checks behave as in production and nothing leaves the machine.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MockAgent } from "undici";
import type { FetchGuardOptions, ResolvedAddress, Resolver } from "./guard.js";

export interface HttpFixture {
  url: string;
  method?: string;
  requestHeaders?: Record<string, string>;
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Where a fixture lives under `dir`: one folder per host, a readable slug plus a short hash. */
export function fixturePath(dir: string, fixture: HttpFixture): string {
  const url = new URL(fixture.url);
  const method = (fixture.method ?? "GET").toUpperCase();
  const slug = `${method}${url.pathname}${url.search}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  const key = JSON.stringify([method, fixture.url, fixture.requestHeaders ?? {}]);
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 10);
  return path.join(dir, url.host.replace(/[^a-z0-9.-]/gi, "_"), `${slug}-${hash}.json`);
}

/** Writes one fixture; returns its path. */
export function saveFixture(dir: string, fixture: HttpFixture): string {
  const file = fixturePath(dir, fixture);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  return file;
}

/** Turns a guarded Response into a fixture for `saveFixture` (recorders, M3 and M4). */
export async function fixtureFromResponse(
  response: Response,
  request: { url: string; method?: string; requestHeaders?: Record<string, string> },
): Promise<HttpFixture> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    // Cookies and connection details aren't part of what an adapter reads.
    if (!["set-cookie", "date", "connection", "keep-alive", "transfer-encoding"].includes(name)) {
      headers[name] = value;
    }
  });
  return {
    url: request.url,
    ...(request.method && request.method !== "GET" ? { method: request.method } : {}),
    ...(request.requestHeaders ? { requestHeaders: request.requestHeaders } : {}),
    status: response.status,
    headers,
    body: await response.text(),
  };
}

/** Every fixture under `dir`, in a stable order. */
export function loadFixtures(dir: string): HttpFixture[] {
  if (!fs.existsSync(dir)) return [];
  const files = (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as HttpFixture);
}

/**
 * Stands in for every recorded host's DNS answer. Nothing connects to it (MockAgent answers), but
 * it must be public, or the guard would refuse the host.
 */
export const REPLAY_ADDRESS: ResolvedAddress = { address: "93.184.215.14", family: 4 };

/** A resolver that answers only for hosts that have fixtures; any other host doesn't resolve. */
export function fixtureResolver(fixtures: readonly HttpFixture[]): Resolver {
  const hosts = new Set(fixtures.map((f) => new URL(f.url).hostname.toLowerCase()));
  return async (hostname) => {
    if (!hosts.has(hostname.toLowerCase())) {
      throw Object.assign(new Error(`No fixtures for ${hostname}`), { code: "ENOTFOUND" });
    }
    return [REPLAY_ADDRESS];
  };
}

/** A MockAgent that answers every recorded request and refuses all others (no network). */
export function mockAgentFromFixtures(fixtures: readonly HttpFixture[]): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  // Specific fixtures (with requestHeaders) first, so they win over the plain one for the same URL.
  const ordered = [...fixtures].sort(
    (a, b) => Object.keys(b.requestHeaders ?? {}).length - Object.keys(a.requestHeaders ?? {}).length,
  );
  for (const fixture of ordered) {
    const url = new URL(fixture.url);
    agent
      .get(url.origin)
      .intercept({
        path: url.pathname + url.search,
        method: (fixture.method ?? "GET").toUpperCase(),
        ...(fixture.requestHeaders ? { headers: fixture.requestHeaders } : {}),
      })
      .reply(fixture.status, fixture.body, { headers: fixture.headers })
      .persist();
  }
  return agent;
}

/** Guard options that replay the fixtures under `dir`. */
export function replayOptions(dir: string): FetchGuardOptions {
  const fixtures = loadFixtures(dir);
  return { dispatcher: mockAgentFromFixtures(fixtures), resolver: fixtureResolver(fixtures) };
}
