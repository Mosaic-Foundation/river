// Check 32 (spec 6), `@live`: the real seed hubs and the real @w3c@w3c.social, over the network.
// Runs only through `npm run test:live` (vitest.live.config.ts), on Adam's machine or in an
// on-demand thread; never in `npm run check`, `test:api`, `test:e2e` or CI (vitest.config.ts
// includes only tests/unit and tests/api, and Playwright only tests/e2e).
//
// Each source goes through the River's own path: the adapter's resolve (what the follow box does),
// then its fetchNew (what the refresh does), both through the production fetch guard (ADR-001:
// real DNS, every address checked; no fixtures). "Zero adapter errors" means neither call throws
// and the fetch reports status ok with no last error. "Renders" means at least one item a feed
// card can draw: shown (not hidden), a kind label, a valid time, something to read, and an
// "Open on {host}" link over https, using the UI's own helpers (ui/src/lib/format.ts).
import { describe, expect, it } from "vitest";
import { civicHubAdapter, fediverseAdapter } from "../../src/river/adapters/index.js";
import { createFetchGuard } from "../../src/shared/fetch/index.js";
import type { Adapter, NormalizedItem, SpaceRecord } from "../../src/shared/items/index.js";
import { kindLabel, linkHost, relativeTime } from "../../ui/src/lib/format.js";

const guard = createFetchGuard();

/** Text a card would show for the item, with tags stripped from its sanitized HTML. */
function cardText(item: NormalizedItem): string {
  const html = (item.contentHtml ?? "").replace(/<[^>]*>/g, " ");
  return [item.title, item.summary, html, item.boostOf ? "boost" : ""].join(" ").replace(/\s+/g, " ").trim();
}

/** True when a feed card can draw the item (see the file comment). */
function renders(item: NormalizedItem, now: Date): boolean {
  return (
    !item.hidden &&
    kindLabel(item.kind).length > 0 &&
    relativeTime(item.publishedAt.toISOString(), now.getTime()) !== "" &&
    (cardText(item).length > 0 || item.media.length > 0) &&
    linkHost(item.url) !== undefined
  );
}

interface Live {
  items: NormalizedItem[];
  rendered: NormalizedItem[];
}

/** Resolves and fetches one source as the River would; fails on any adapter error. */
async function readLive(adapter: Adapter, input: string): Promise<Live> {
  const now = new Date();
  const preview = await adapter.resolve(input, { guard, now });
  expect(preview.adapter).toBe(adapter.name);
  expect(preview.name.length).toBeGreaterThan(0);
  const space: SpaceRecord = {
    id: "00000000-0000-4000-8000-000000000032",
    adapter: preview.adapter,
    canonicalUrl: preview.canonicalUrl,
    feedUrl: preview.feedUrl ?? null,
    actorId: preview.actorId ?? null,
    network: preview.network ?? null,
    manifest: preview.manifest,
    etag: null,
    etagUrl: null,
    newestItemAt: null,
  };
  const result = await adapter.fetchNew(space, { guard, now, isKnown: () => false });
  expect(result.notModified).toBe(false);
  expect(result.space.fetchStatus ?? "ok", `${input}: ${result.space.lastError ?? ""}`).toBe("ok");
  expect(result.space.lastError ?? null).toBeNull();
  return {
    items: result.items,
    rendered: result.items.filter((item) => renders(item, now)),
  };
}

describe("check 32: the seed sources, live", () => {
  for (const hub of ["https://demosville.civic.social", "https://floyd.civic.social", "https://longmont.civic.social"]) {
    it(`@live ${hub} parses with zero adapter errors and renders at least one item`, async () => {
      const live = await readLive(civicHubAdapter, hub);
      expect(live.rendered.length, `${hub}: ${live.items.length} items, none a card can draw`).toBeGreaterThan(0);
      for (const item of live.rendered) expect(item.sourceId.length).toBeGreaterThan(0);
    });
  }

  it("@live @w3c@w3c.social renders at least one post", async () => {
    const live = await readLive(fediverseAdapter, "@w3c@w3c.social");
    const posts = live.rendered.filter((item) => !item.boostOf);
    expect(posts.length, `${live.items.length} items, ${live.rendered.length} drawable, none a w3c post`).toBeGreaterThan(0);
    for (const post of posts) expect(linkHost(post.url)).toBe("w3c.social");
  });
});
