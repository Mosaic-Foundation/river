// `npm run record-fixtures`: re-records real responses from the seed hosts into
// tests/fixtures/http/ (spec 6). Run only when told to; tests never call outside hosts.
//
// Each adapter registers a recorder here as it lands: the Civic Hub adapter (M3) for Demosville,
// Floyd and Longmont, the fediverse adapter (M4) for the seed accounts. Recorders fetch through
// the fetch guard (src/shared/fetch/, M2, ADR-001), so the file format matches its replay mode.

interface Recorder {
  /** e.g. "civic-hub: demosville.civic.social". */
  name: string;
  /** Fetches and writes the fixtures; returns the paths written. */
  record(outDir: string): Promise<string[]>;
}

const OUT_DIR = "tests/fixtures/http";

const recorders: Recorder[] = [];

async function main(): Promise<void> {
  if (recorders.length === 0) {
    console.log("No recorders yet: the Civic Hub adapter (M3) adds the first. Nothing was fetched.");
    return;
  }
  for (const recorder of recorders) {
    const written = await recorder.record(OUT_DIR);
    console.log(`${recorder.name}: ${written.length} file(s)`);
  }
}

await main();

export {};
