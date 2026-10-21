// Records real responses from the seed hubs (spec 6) by running the Civic Hub adapter itself over
// a guard that saves every response it returns. The recorded URLs are therefore exactly the ones
// the adapter asks for on replay, with `since` computed from CIVIC_HUB_FIXTURE_NOW.
//
// Per hub: civic.json; the first fetch (up to 5 pages); a refresh's first page and its ETag; the
// same refresh again with If-None-Match (the hub's own 304, stored with its request header); one
// stream validation per process type seen, through the UI path a person would paste; and the
// validation of a process the hub doesn't serve (an empty page: stream not found, check 33).
import fs from "node:fs";
import path from "node:path";
import {
  createFetchGuard,
  fixtureFromResponse,
  saveFixture,
  type FetchGuard,
} from "../../src/shared/fetch/index.js";
import type { SpaceRecord } from "../../src/shared/items/index.js";
import { civicHubAdapter } from "../../src/river/adapters/civicHub/index.js";
import { CIVIC_HUB_FIXTURE_HOSTS, CIVIC_HUB_FIXTURE_NOW } from "../../tests/fixtures/civicHubClock.js";

/** UI path per process type, so stream validation is recorded the way people paste hub links. */
const UI_PATH: Record<string, string> = {
  "civic.meeting_summary": "meeting-summary",
  "civic.brief": "brief",
  "civic.project": "project",
  "civic.announcement": "announcement",
};

/** A process id no hub serves: its validation is a real empty page. */
const MISSING_PROCESS = "proc_0000000000000000";

function recordingGuard(outDir: string, written: string[]): FetchGuard {
  const guard = createFetchGuard();
  return {
    async fetch(url, init) {
      const res = await guard.fetch(url, init);
      const inm = init?.headers?.["if-none-match"];
      const fixture = await fixtureFromResponse(res.clone(), {
        url,
        ...(inm ? { requestHeaders: { "if-none-match": inm } } : {}),
      });
      written.push(saveFixture(outDir, fixture));
      return res;
    },
  };
}

async function recordHub(host: string, outDir: string): Promise<string[]> {
  const written: string[] = [];
  fs.rmSync(path.join(outDir, host), { recursive: true, force: true });
  const guard = recordingGuard(outDir, written);
  const now = CIVIC_HUB_FIXTURE_NOW;

  const preview = await civicHubAdapter.resolve(`https://${host}`, { guard, now });
  const space: SpaceRecord = {
    id: host,
    adapter: "civic_hub",
    canonicalUrl: preview.canonicalUrl,
    feedUrl: preview.feedUrl ?? null,
    manifest: preview.manifest,
  };

  const first = await civicHubAdapter.fetchNew(space, { guard, now });
  console.log(`${host}: first fetch ${first.items.length} items`);

  // Refresh twice: the first stores the ETag for the refresh URL, the second sends it back.
  if (first.space.newestItemAt) {
    const refreshed = { ...space, newestItemAt: first.space.newestItemAt };
    const second = await civicHubAdapter.fetchNew(refreshed, { guard, now });
    console.log(`${host}: refresh ${second.items.length} items, etag ${second.space.etag ? "yes" : "no"}`);
    if (second.space.etag) {
      const third = await civicHubAdapter.fetchNew(
        { ...refreshed, etag: second.space.etag, etagUrl: second.space.etagUrl ?? null },
        { guard, now },
      );
      console.log(`${host}: refresh with If-None-Match: ${third.notModified ? "304" : "200 (no 304 recorded)"}`);
    }
  }

  // One stream validation per process type, through the path a person would paste.
  const byType = new Map<string, string>();
  for (const item of first.items) {
    const type = item.civic?.processType;
    const key = item.streamKey;
    if (type && key && !byType.has(type)) byType.set(type, key);
  }
  for (const [type, key] of byType) {
    const id = key.slice(key.lastIndexOf("/") + 1);
    await civicHubAdapter.resolve(`https://${host}/${UI_PATH[type] ?? "process"}/${id}`, { guard, now });
  }
  await civicHubAdapter
    .resolve(`https://${host}/process/${MISSING_PROCESS}`, { guard, now })
    .then(
      () => console.log(`${host}: ${MISSING_PROCESS} unexpectedly resolved`),
      () => console.log(`${host}: ${MISSING_PROCESS} is not served, as expected`),
    );

  return [...new Set(written)];
}

export const civicHubRecorders = CIVIC_HUB_FIXTURE_HOSTS.map((host) => ({
  name: `civic-hub: ${host}`,
  record: (outDir: string) => recordHub(host, outDir),
}));
