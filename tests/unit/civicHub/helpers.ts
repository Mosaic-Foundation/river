// Shared by the Civic Hub adapter tests: the recorded fixtures (tests/fixtures/http/, real
// responses from Demosville, Floyd and Longmont), a replaying guard that logs every request, and
// the recorded activities themselves. Nothing here touches the network.
import {
  createFetchGuard,
  fixtureResolver,
  loadFixtures,
  mockAgentFromFixtures,
  type FetchGuard,
  type GuardedRequest,
  type HttpFixture,
} from "../../../src/shared/fetch/index.js";
import { CIVIC_HUB_FIXTURE_HOSTS, CIVIC_HUB_FIXTURE_NOW } from "../../fixtures/civicHubClock.js";

export const NOW = CIVIC_HUB_FIXTURE_NOW;
export const HOSTS = CIVIC_HUB_FIXTURE_HOSTS;

export const RECORDED: readonly HttpFixture[] = loadFixtures("tests/fixtures/http").filter((f) =>
  (HOSTS as readonly string[]).includes(new URL(f.url).hostname),
);

export interface LoggedRequest {
  url: string;
  headers: Record<string, string>;
}

/** A guard replaying `fixtures` (the recorded ones by default), logging each request it is asked for. */
export function replayGuard(fixtures: readonly HttpFixture[] = RECORDED): { guard: FetchGuard; requests: LoggedRequest[] } {
  const inner = createFetchGuard({ dispatcher: mockAgentFromFixtures(fixtures), resolver: fixtureResolver(fixtures) });
  const requests: LoggedRequest[] = [];
  const guard: FetchGuard = {
    fetch(url: string, init?: GuardedRequest) {
      requests.push({ url, headers: { ...(init?.headers ?? {}) } });
      return inner.fetch(url, init);
    },
  };
  return { guard, requests };
}

/** The recorded fixture for an exact URL (the plain one, not a conditional 304). */
export function recorded(url: string): HttpFixture {
  const found = RECORDED.find((f) => f.url === url && !f.requestHeaders);
  if (!found) throw new Error(`No recorded fixture for ${url}`);
  return found;
}

export type Activity = Record<string, unknown> & {
  id: string;
  type: string;
  object: Record<string, unknown>;
  context?: Record<string, unknown>;
};

/** Every activity in the recorded feed pages, deduplicated by id. */
export function recordedActivities(): Activity[] {
  const byId = new Map<string, Activity>();
  for (const f of RECORDED) {
    if (f.status !== 200 || !f.url.includes("/events")) continue;
    const body = JSON.parse(f.body) as { orderedItems?: Activity[] };
    for (const a of body.orderedItems ?? []) byId.set(a.id, a);
  }
  return [...byId.values()];
}

/** The first recorded activity of a shape, or undefined. */
export function recordedActivity(type: string, objectType: string, processType?: string): Activity | undefined {
  return recordedActivities().find(
    (a) =>
      a.type === type &&
      a.object?.type === objectType &&
      (processType === undefined || a.context?.["civic:processType"] === processType),
  );
}

/** A feed page fixture (for derived, test-only sequences). */
export function pageFixture(url: string, items: unknown[], extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): HttpFixture {
  return {
    url,
    status: 200,
    headers: { "content-type": "application/activity+json; charset=utf-8", ...headers },
    body: JSON.stringify({ type: "OrderedCollectionPage", orderedItems: items, ...extra }),
  };
}
