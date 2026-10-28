// The fetch guard that linking (and later acting) uses for members' fediverse servers (ADR-011
// item 6). In production that is the process's guard, unchanged. With the test-only
// TEST_STAND_IN_FEDIVERSE=1 (refused on Vercel by env.ts) it is a guard whose injected dispatcher
// sends the stand-in hosts to the stand-in server in tests/support/standInMastodon/, and every
// other host to the recorded fixtures (FETCH_FIXTURES_DIR) or nowhere. The stand-in is loaded
// with a dynamic import, so the build never includes it and production never loads it.
import { env } from "../../../config/env.js";
import {
  createFetchGuard,
  fixtureResolver,
  getFetchGuard,
  loadFixtures,
  mockAgentFromFixtures,
  type FetchGuard,
  type FetchGuardOptions,
  type Resolver,
} from "../../../shared/fetch/index.js";

/** What the River's dev server uses of the stand-in (tests/support/standInMastodon/StandInFediverse). */
export interface StandInHarness {
  guardOptions(fallback?: { dispatcher: NonNullable<FetchGuardOptions["dispatcher"]>; resolver: Resolver }): FetchGuardOptions;
  authorize(url: string, username: string, options?: { deny?: boolean }): { location: string } | { error: string };
  readonly requests: unknown[];
  readonly rules: unknown[];
  readonly tokens: Map<string, unknown>;
  readonly apps: Map<string, unknown>;
  posted(): unknown[];
  reset(): void;
  revokeAll(): void;
}

let harness: Promise<{ standIn: StandInHarness; guard: FetchGuard }> | undefined;

/** The stand-in and its guard, made once per process. Only when TEST_STAND_IN_FEDIVERSE=1. */
export function standInFediverse(): Promise<{ standIn: StandInHarness; guard: FetchGuard }> {
  if (!env.testStandInFediverse) throw new Error("TEST_STAND_IN_FEDIVERSE is not set");
  harness ??= (async () => {
    const path = new URL("../../../../tests/support/standInMastodon/index.ts", import.meta.url).href;
    const mod = (await import(path)) as { StandInFediverse: new () => StandInHarness };
    const standIn = new mod.StandInFediverse();
    const dir = env.fetchFixturesDir;
    const fixtures = dir ? loadFixtures(dir) : [];
    const fallback = dir ? { dispatcher: mockAgentFromFixtures(fixtures), resolver: fixtureResolver(fixtures) } : undefined;
    return { standIn, guard: createFetchGuard(standIn.guardOptions(fallback)) };
  })();
  return harness;
}

/** The guard for requests to members' fediverse servers. */
export async function fediverseGuard(): Promise<FetchGuard> {
  return env.testStandInFediverse ? (await standInFediverse()).guard : getFetchGuard();
}
