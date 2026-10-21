// Replays the recorded fediverse responses (tests/fixtures/http/, recorded from the seed
// accounts by `npm run record-fixtures`) through the real fetch guard, with no network.
//
// derived() makes a TEST-ONLY variant of a recorded response (another status, an edited body)
// for cases the live accounts don't show: an outbox refused with 401/403, a 429, a post carrying
// <script>. Every derived response starts from a real recorded one and is built here, in the
// test, never written to the recorded folder.
import { fileURLToPath } from "node:url";
import { MockAgent, type Dispatcher } from "undici";
import {
  createFetchGuard,
  fixtureResolver,
  loadFixtures,
  mockAgentFromFixtures,
  type FetchGuard,
  type HttpFixture,
} from "../../../src/shared/fetch/index.js";

export const RECORDED_DIR = fileURLToPath(new URL("../../fixtures/http/", import.meta.url));

/** The moment the fixtures were recorded, roughly; tests use it as "now". */
export const NOW = new Date("2026-10-21T01:00:00Z");

let recorded: HttpFixture[] | undefined;

export function recordedFixtures(): HttpFixture[] {
  recorded ??= loadFixtures(RECORDED_DIR);
  return recorded;
}

/** The recorded fixture for a GET of `url`; throws if there is none. */
export function recordedFixture(url: string): HttpFixture {
  const found = recordedFixtures().find((f) => f.url === url && (f.method ?? "GET") === "GET");
  if (!found) throw new Error(`No recorded fixture for ${url}`);
  return found;
}

/** The recorded body of `url`, parsed. */
export function recordedJson<T = Record<string, unknown>>(url: string): T {
  return JSON.parse(recordedFixture(url).body) as T;
}

/** A TEST-ONLY response derived from the recorded one for `url` (or a new URL on a recorded host). */
export function derived(
  url: string,
  change: { status?: number; body?: unknown; headers?: Record<string, string>; from?: string },
): HttpFixture {
  const base = recordedFixture(change.from ?? url);
  const headers = { ...base.headers, ...change.headers };
  delete headers["content-length"];
  return {
    url,
    status: change.status ?? base.status,
    headers,
    body: change.body === undefined ? base.body : typeof change.body === "string" ? change.body : JSON.stringify(change.body),
  };
}

export interface ReplayGuard {
  guard: FetchGuard;
  /** Every request the guard sent, as "GET https://host/path?query". */
  calls: string[];
}

/** A guard replaying the recorded fixtures, with `overrides` replacing recorded ones for the same URL. */
export function replayGuard(overrides: HttpFixture[] = []): ReplayGuard {
  const replaced = new Set(overrides.map((f) => f.url));
  const fixtures = [...recordedFixtures().filter((f) => !replaced.has(f.url)), ...overrides];
  const mock: MockAgent = mockAgentFromFixtures(fixtures);
  const calls: string[] = [];
  const dispatcher = {
    request(opts: Dispatcher.RequestOptions) {
      calls.push(`${opts.method} ${String(opts.origin)}${opts.path}`);
      return mock.request(opts);
    },
  } as unknown as Dispatcher;
  const guard = createFetchGuard({ dispatcher, resolver: fixtureResolver(fixtures), now: () => NOW.getTime() });
  return { guard, calls };
}
