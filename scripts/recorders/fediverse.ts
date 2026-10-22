// Fediverse recorder (M4, spec 4.3 and 6): runs the adapter itself against the seed accounts
// through a guard that saves every response, so the fixtures hold exactly the requests the
// adapter sends (same URLs, same Accept headers): WebFinger, the actor, NodeInfo (well-known and
// the document), the outbox and its pages, and, where the server needs it, Mastodon's REST API.
// fetchNew also fills boosts (spec 4.3), so the boosted posts and their authors that live on a
// seed host are recorded too; boosts elsewhere are refused by this guard and keep their plain card.
//
// Only the seed hosts ADR-001 names are fetched. fedizen.net waits for Adam's approval (ADR-001
// item 2), so it is not here.
import { createFetchGuard, fixtureFromResponse, saveFixture, type FetchGuard } from "../../src/shared/fetch/index.js";
import type { SpaceRecord } from "../../src/shared/items/index.js";
import { fediverseAdapter, readManifest } from "../../src/river/adapters/fediverse/index.js";

export const FEDIVERSE_SEEDS = [
  "@w3c@w3c.social",
  "@wearenew_public@mastodon.social",
  "@eff@mastodon.social",
  "@internetarchive@mastodon.archive.org",
  "@wikipedia@wikis.world",
  "@swf@socialwebfoundation.org",
] as const;

const SEED_HOSTS = new Set([
  "w3c.social",
  "mastodon.social",
  "mastodon.archive.org",
  "wikis.world",
  "socialwebfoundation.org",
]);

/** A guard that refuses non-seed hosts and saves every response it returns. */
function recordingGuard(outDir: string, written: string[]): FetchGuard {
  const inner = createFetchGuard();
  return {
    async fetch(url, init = {}) {
      const host = new URL(url).host.toLowerCase();
      if (!SEED_HOSTS.has(host)) throw new Error(`Not a seed host, not recorded: ${host}`);
      const res = await inner.fetch(url, init);
      const fixture = await fixtureFromResponse(res.clone(), { url, method: init.method });
      written.push(saveFixture(outDir, fixture));
      return res;
    },
  };
}

async function recordAccount(handle: string, outDir: string): Promise<string[]> {
  const written: string[] = [];
  const guard = recordingGuard(outDir, written);
  const now = new Date();
  const preview = await fediverseAdapter.resolve(handle, { guard, now });
  const space: SpaceRecord = {
    id: "recording",
    adapter: "fediverse",
    canonicalUrl: preview.canonicalUrl,
    feedUrl: preview.feedUrl ?? null,
    actorId: preview.actorId ?? null,
    network: preview.network ?? null,
    manifest: preview.manifest,
  };
  const result = await fediverseAdapter.fetchNew(space, { guard, now, isKnown: () => false });
  const boosts = result.items.filter((i) => i.boostOf);
  console.log(
    `  ${handle}: ${preview.name} (${preview.network ?? "no NodeInfo"}, via ${String(readManifest(preview.manifest).via)}), ` +
      `${result.items.length} items, ${boosts.filter((i) => i.contentHtml).length}/${boosts.length} boosts filled, ` +
      `status ${result.space.fetchStatus ?? "?"}`,
  );
  return written;
}

/**
 * Mastodon's REST statuses for one account read through the fallback's lookup (mastodon.social
 * refuses unsigned actor reads but serves outboxes, so fetchNew never needs this call there; it is
 * recorded so the fallback's mapping is tested on a real response).
 */
async function recordRestStatuses(outDir: string): Promise<string[]> {
  const written: string[] = [];
  const guard = recordingGuard(outDir, written);
  const preview = await fediverseAdapter.resolve("@eff@mastodon.social", { guard, now: new Date() });
  const id = readManifest(preview.manifest).mastodonAccountId;
  if (!id) return written;
  const url = `https://mastodon.social/api/v1/accounts/${id}/statuses?limit=20&exclude_replies=true`;
  const res = await guard.fetch(url, { headers: { accept: "application/json" } });
  console.log(`  REST statuses for @eff@mastodon.social: ${res.status}`);
  return written;
}

export const fediverseRecorder = {
  name: "fediverse: seed accounts",
  async record(outDir: string): Promise<string[]> {
    const written: string[] = [];
    for (const handle of FEDIVERSE_SEEDS) {
      try {
        written.push(...(await recordAccount(handle, outDir)));
      } catch (err) {
        // Record what really happened and carry on; the fixtures already written stay.
        console.log(`  ${handle}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      }
    }
    written.push(...(await recordRestStatuses(outDir)));
    return [...new Set(written)];
  },
};
