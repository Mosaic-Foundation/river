// Framing-check recorder (ui-revisions-2 item 2, ADR-008): runs the River's framing check itself
// on a few stored items' pages from the seed hosts, through a guard that saves every response, so
// each file is the request the check really sends. One page that allows framing and one that
// refuses it are enough for the tests; Mastodon posts are framed through their /embed page and
// never checked.
import { createFetchGuard, fixtureFromResponse, saveFixture, type FetchGuard } from "../../src/shared/fetch/index.js";
import { checkFraming } from "../../src/river/frame/check.js";

export const FRAME_PAGES = [
  // A WordPress article (the @swf seed's own post): no X-Frame-Options, no frame-ancestors.
  "https://socialwebfoundation.org/2026/10/13/fosdem-2027-dev-room-application-is-in/",
  // A Civic Hub meeting summary: X-Frame-Options DENY and frame-ancestors 'none'.
  "https://longmont.civic.social/meeting-summary/proc_4ebb11759c4c40ce",
] as const;

const SEED_HOSTS = new Set(["socialwebfoundation.org", "longmont.civic.social"]);

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

export const framesRecorder = {
  name: "frames: framing-check pages",
  async record(outDir: string): Promise<string[]> {
    const written: string[] = [];
    const guard = recordingGuard(outDir, written);
    for (const page of FRAME_PAGES) {
      const answer = await checkFraming(page, "https://river.mosaic.social", { guard });
      console.log(`${page}: ${answer.frame ? "frames" : answer.reason}`);
    }
    return written;
  },
};
