// Outbound HTTP for River and identity-host code (ADR-001). Nothing outside this folder imports
// undici, node:http or node:https, or calls global fetch on the server (eslint.config.js).
import { env } from "../../config/env.js";
import { createFetchGuard, type FetchGuard, type GuardedRequest } from "./guard.js";
import { replayOptions } from "./fixtures.js";

export { isBlockedHostname, isBlockedIp } from "./addresses.js";
export { FetchError, followMessage, type FetchErrorCode } from "./errors.js";
export {
  createFetchGuard,
  LIMITS,
  USER_AGENT,
  type FetchGuard,
  type FetchGuardOptions,
  type GuardedRequest,
  type Resolver,
} from "./guard.js";
export { isLoopbackHttpUrl, loopbackFetch } from "./loopback.js";
export {
  fixtureFromResponse,
  fixturePath,
  fixtureResolver,
  loadFixtures,
  mockAgentFromFixtures,
  saveFixture,
  type HttpFixture,
} from "./fixtures.js";

let defaultGuard: FetchGuard | undefined;

/**
 * The process's guard: the network, or the recorded responses under FETCH_FIXTURES_DIR (which the
 * app refuses to read on Vercel). Adapters take a FetchGuard parameter and default to this one.
 */
export function getFetchGuard(): FetchGuard {
  if (!defaultGuard) {
    const fixturesDir = env.fetchFixturesDir;
    defaultGuard = createFetchGuard(fixturesDir ? replayOptions(fixturesDir) : {});
  }
  return defaultGuard;
}

/** Shorthand for getFetchGuard().fetch(). */
export function guardedFetch(url: string, init?: GuardedRequest): Promise<Response> {
  return getFetchGuard().fetch(url, init);
}
