// Shared setup for the refresh and feed database tests: test spaces as river_app, and a fetch
// guard that replays tests/fixtures/http/ and counts what reaches the (mock) network.
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Dispatcher } from "undici";
import { forInstance, type ClientSource } from "../../../src/db/context.js";
import {
  createFetchGuard,
  fixtureResolver,
  loadFixtures,
  mockAgentFromFixtures,
  type FetchGuard,
} from "../../../src/shared/fetch/index.js";
import { SPACE_COLUMNS, type SpaceRow } from "../../../src/river/feed/spaces.js";
import { SEED_INSTANCE } from "./roles.js";

export const FIXTURES_DIR = path.resolve("tests/fixtures/http");
export const DEMOSVILLE_FEED = "https://demosville.civic.social/events";
export const LONGMONT_FEED = "https://longmont.civic.social/events";

export interface CountingGuard extends FetchGuard {
  /** URLs that reached the mock network, in order. */
  requests: string[];
}

/** The real guard over a MockAgent built from the recordings; counts every request it sends. */
export function replayGuard(): CountingGuard {
  const fixtures = loadFixtures(FIXTURES_DIR);
  const agent = mockAgentFromFixtures(fixtures);
  const requests: string[] = [];
  const counting = {
    request(options: Dispatcher.RequestOptions) {
      requests.push(`${String(options.origin)}${options.path}`);
      return agent.request(options);
    },
  } as unknown as Dispatcher;
  const guard = createFetchGuard({ dispatcher: counting, resolver: fixtureResolver(fixtures) });
  return { fetch: guard.fetch, requests };
}

/** A hub space of its own (unique canonical URL) reading a recorded feed. */
export async function createHubSpace(
  source: ClientSource,
  feedUrl: string,
  columns: Record<string, unknown> = {},
): Promise<SpaceRow> {
  return forInstance(
    SEED_INSTANCE,
    async (db) => {
      const row = await db.insert("spaces", {
        adapter: "civic_hub",
        canonical_url: `https://refresh-test.invalid/${randomUUID()}`,
        feed_url: feedUrl,
        category: "civic",
        name: `Refresh test ${randomUUID().slice(0, 8)}`,
        ...columns,
      });
      const { rows } = await db.query<SpaceRow>(`SELECT ${SPACE_COLUMNS} FROM river.spaces WHERE id = $1`, [row.id]);
      return rows[0] as SpaceRow;
    },
    source,
  );
}

export async function spaceRow(source: ClientSource, id: string): Promise<SpaceRow> {
  return forInstance(
    SEED_INSTANCE,
    async (db) => (await db.query<SpaceRow>(`SELECT ${SPACE_COLUMNS} FROM river.spaces WHERE id = $1`, [id])).rows[0] as SpaceRow,
    source,
  );
}

/** Waits on real I/O without timers (fake timers may be installed). */
export async function until(check: () => Promise<boolean>, tries = 2_000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition never became true");
}
