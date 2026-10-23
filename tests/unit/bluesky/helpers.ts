// Recorded Bluesky responses (tests/fixtures/http/public.api.bsky.app and plc.directory, recorded
// 2026-10-23 by `npm run record-fixtures -- --bluesky`) for the Bluesky unit tests.
import { authorFeedUrl } from "../../../src/river/adapters/bluesky/index.js";
import { recordedFixtures, recordedJson } from "../helpers/fediverseFixtures.js";

/** Close to when the Bluesky fixtures were recorded; the adapters' clock in these tests. */
export const BSKY_NOW = new Date("2026-10-23T18:00:00Z");

export const DIDS = {
  /** @bsky.app: a custom-domain handle; reposts, quotes, videos. */
  bskyApp: "did:plc:z72i7hdynmk6r22z27h6tvur",
  /** @publicdomainrev.bsky.social: a bsky.social handle; images. */
  publicDomainReview: "did:plc:ywdrhkssnvgtfyujsz45jnlb",
  /** @wikipedia.org: galleries and videos. */
  wikipedia: "did:plc:plla3i7zproko3ekdnkoykhe",
  /** @atproto.com: link cards and quotes; followed by DID. */
  atproto: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
} as const;

/** Every recorded getAuthorFeed entry for a DID, newest page first. */
export function recordedEntries(did: string): Array<Record<string, unknown>> {
  const first = authorFeedUrl(did);
  const pages = recordedFixtures().filter((f) => f.url.startsWith(`${first}&cursor=`) || f.url === first);
  pages.sort((a, b) => (a.url === first ? -1 : b.url === first ? 1 : 0));
  return pages.flatMap((page) => (JSON.parse(page.body) as { feed: Array<Record<string, unknown>> }).feed);
}

/** The recorded entry whose post (or repost) URI ends with `rkey`. */
export function recordedEntry(did: string, rkey: string): Record<string, unknown> {
  const found = recordedEntries(did).find((entry) => {
    const reason = entry.reason as { uri?: string } | undefined;
    const post = entry.post as { uri: string };
    return (reason?.uri ?? post.uri).endsWith(`/${rkey}`);
  });
  if (!found) throw new Error(`No recorded entry ${rkey} for ${did}`);
  return structuredClone(found);
}

export { recordedJson };
