// Media recorder (M12): records a podcast or RSS/Atom feed, or a PeerTube channel, by running the
// follow box's resolve (all adapters in order, as a member would) and the chosen adapter's fetch
// through a guard that saves every response. Only the addresses given on the command line are
// fetched:
//
//   npm run record-fixtures -- --media https://example.org/feed.xml --media @channel@tube.example
//
// Nothing is recorded by default: which real video and podcast sources the River uses is Adam's
// choice (DECISIONS.md, "Proposed real media seeds"). The M12 thread could not reach any candidate
// host from its sandbox, so tests/fixtures/http/synthetic-* stand in until this is run.
import { createFetchGuard, fixtureFromResponse, saveFixture, type FetchGuard } from "../../src/shared/fetch/index.js";
import type { SpaceRecord } from "../../src/shared/items/index.js";
import { adapterNamed, adaptersFor, resolveWith } from "../../src/river/adapters/index.js";

/** A guard that saves every response it returns, with the If-None-Match it was asked with. */
function recordingGuard(outDir: string, written: string[]): FetchGuard {
  const inner = createFetchGuard();
  return {
    async fetch(url, init = {}) {
      const res = await inner.fetch(url, init);
      const inm = init.headers?.["if-none-match"];
      const fixture = await fixtureFromResponse(res.clone(), {
        url,
        method: init.method,
        ...(inm ? { requestHeaders: { "if-none-match": inm } } : {}),
      });
      written.push(saveFixture(outDir, fixture));
      return res;
    },
  };
}

async function recordOne(input: string, outDir: string): Promise<string[]> {
  const written: string[] = [];
  const guard = recordingGuard(outDir, written);
  const now = new Date();
  const preview = await resolveWith(adaptersFor(input), input, { guard, now });
  const adapter = adapterNamed(preview.adapter);
  if (!adapter) throw new Error(`No adapter refreshes ${preview.adapter}`);
  const space: SpaceRecord = {
    id: "recording",
    adapter: preview.adapter,
    canonicalUrl: preview.canonicalUrl,
    feedUrl: preview.feedUrl ?? null,
    actorId: preview.actorId ?? null,
    network: preview.network ?? null,
    manifest: preview.manifest,
  };
  const result = await adapter.fetchNew(space, { guard, now, isKnown: () => false });
  console.log(`  ${input}: ${preview.name} (${preview.adapter}, ${preview.network ?? "?"}), ${result.items.length} items`);
  // The feed's own 304, when it sends an ETag (refresh replays If-None-Match).
  if (result.space.etag && result.space.etagUrl) {
    await adapter.fetchNew({ ...space, etag: result.space.etag, etagUrl: result.space.etagUrl }, { guard, now });
  }
  return written;
}

/** The --media values on the command line. */
export function mediaInputs(argv: readonly string[]): string[] {
  const inputs: string[] = [];
  argv.forEach((arg, i) => {
    if (arg === "--media" && argv[i + 1]) inputs.push(argv[i + 1] as string);
    else if (arg.startsWith("--media=")) inputs.push(arg.slice("--media=".length));
  });
  return inputs;
}

export function mediaRecorder(inputs: readonly string[]) {
  return {
    name: `media: ${inputs.join(", ")}`,
    async record(outDir: string): Promise<string[]> {
      const written: string[] = [];
      for (const input of inputs) {
        try {
          written.push(...(await recordOne(input, outDir)));
        } catch (err) {
          console.log(`  ${input}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
        }
      }
      return [...new Set(written)];
    },
  };
}
