// Bluesky recorder (ADR-009): runs the Bluesky adapter itself through a guard that saves every
// response, so the fixtures hold exactly the requests the adapter sends: resolveHandle, the DID
// document (plc.directory), getProfile and getAuthorFeed's pages. For "Import from Bluesky" it also
// records app.bsky.graph.getFollows for one account, every page.
//
//   npm run record-fixtures -- --bluesky
//
// Only ADR-009's hosts are fetched (the AppView and the PLC directory); a handle's own
// /.well-known/atproto-did is not needed for these accounts (the AppView resolves them all).
import { createFetchGuard, fixtureFromResponse, saveFixture, type FetchGuard } from "../../src/shared/fetch/index.js";
import type { SpaceRecord } from "../../src/shared/items/index.js";
import { blueskyAdapter, followsUrl, readFollows } from "../../src/river/adapters/bluesky/index.js";

/**
 * The recorded accounts, each for what it shows: `@bsky.app` a custom-domain handle with reposts
 * (images, video, link cards, quotes, quote with media) and its own quotes and videos;
 * `@publicdomainrev.bsky.social` a bsky.social handle with images and alt text; `@wikipedia.org`
 * galleries and videos; `@atproto.com` link cards and quotes, followed by DID; the profile URL
 * form for `publicdomainrev`.
 */
export const BLUESKY_ACCOUNTS = [
  "@bsky.app",
  "@publicdomainrev.bsky.social",
  "@wikipedia.org",
  "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
  "https://bsky.app/profile/publicdomainrev.bsky.social",
] as const;

/** The account whose follows the import fixtures list (263 accounts on 2026-10-23: three pages). */
export const BLUESKY_IMPORT_ACCOUNT = "@eff.org";

const HOSTS = new Set(["public.api.bsky.app", "plc.directory"]);

function recordingGuard(outDir: string, written: string[]): FetchGuard {
  const inner = createFetchGuard();
  return {
    async fetch(url, init = {}) {
      const host = new URL(url).host.toLowerCase();
      if (!HOSTS.has(host)) throw new Error(`Not an ADR-009 host, not recorded: ${host}`);
      const res = await inner.fetch(url, init);
      const fixture = await fixtureFromResponse(res.clone(), { url, method: init.method });
      written.push(saveFixture(outDir, fixture));
      return res;
    },
  };
}

async function recordAccount(input: string, outDir: string, now: Date): Promise<string[]> {
  const written: string[] = [];
  const guard = recordingGuard(outDir, written);
  const preview = await blueskyAdapter.resolve(input, { guard, now });
  const space: SpaceRecord = {
    id: "recording",
    adapter: "atproto",
    canonicalUrl: preview.canonicalUrl,
    actorId: preview.actorId ?? null,
    network: preview.network ?? null,
    manifest: preview.manifest,
  };
  const result = await blueskyAdapter.fetchNew(space, { guard, now, isKnown: () => false });
  const reposts = result.items.filter((i) => i.boostOf).length;
  console.log(`  ${input}: ${preview.name} (${preview.canonicalUrl}), ${result.items.length} items, ${reposts} reposts`);
  return written;
}

async function recordFollows(outDir: string): Promise<string[]> {
  const written: string[] = [];
  const guard = recordingGuard(outDir, written);
  const listing = await readFollows(guard, BLUESKY_IMPORT_ACCOUNT);
  console.log(
    `  follows of ${BLUESKY_IMPORT_ACCOUNT}: ${listing.accounts.length} accounts (${listing.skipped} skipped) from ${followsUrl(listing.account.did)}`,
  );
  return written;
}

export const blueskyRecorder = {
  name: "bluesky",
  async record(outDir: string): Promise<string[]> {
    const now = new Date();
    const written: string[] = [];
    for (const input of BLUESKY_ACCOUNTS) {
      try {
        written.push(...(await recordAccount(input, outDir, now)));
      } catch (err) {
        console.log(`  ${input}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      }
    }
    written.push(...(await recordFollows(outDir)));
    return [...new Set(written)];
  },
};
