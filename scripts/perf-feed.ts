// Check 34 (spec 6), manual, not a gate: times `GET /api/feed` for a member with 20 follows and a
// warm cache, against a local dev server that replays recorded responses (FETCH_FIXTURES_DIR,
// TEST_CLOCK_NOW, as for `npm run test:api`). No real host is contacted: the dev server replays
// fixtures and this script talks only to loopback. Results go in docs/perf/feed-report.md.
//
//   npx supabase db reset
//   npm run dev &                       # with the test:api .env (TEST_DID_LOOPBACK=1, :3005 trusted)
//   npx tsx scripts/perf-feed.ts        # PERF_RUNS=200 to change the sample size
//
// The member signs in through the River's real callback with a test DID served on :3005
// (tests/api/helpers/member.ts). Their 20 follows: the 16 seed follows copied at sign-up (3 hubs,
// 6 fediverse accounts, 7 sample spaces) plus 4 "just this stream" follows of open hub processes,
// counted through GET /api/me/export. "Warm" means every followed space was refreshed less than
// 120 s ago (spec 4.3), so the request claims nothing and answers from the database; the script
// re-primes if a run would cross that line.
import os from "node:os";
import { performance } from "node:perf_hooks";
import { API, DidLogServer, requireApi, type Member } from "../tests/api/helpers/member.js";

const RUNS = Number(process.env.PERF_RUNS ?? 100);
const WARMUP = 5;
const STREAM_FOLLOWS = 4;
const WARM_WINDOW_MS = 100_000; // under the 120 s refresh interval, with room to spare

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) {
  throw new Error(`perf-feed runs only against a local dev server, not ${API}`);
}

interface FollowingPage {
  spaces: Array<{ id: string; adapter: string; name: string; streams: Array<{ id: string; status: string; rule: string | null }> }>;
}

async function timed(path: string, cookie?: string): Promise<{ ms: number; bytes: number; items: number }> {
  const start = performance.now();
  const res = await fetch(`${API}${path}`, { headers: cookie ? { cookie } : {} });
  const text = await res.text();
  const ms = performance.now() - start;
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${text.slice(0, 200)}`);
  return { ms, bytes: Buffer.byteLength(text), items: (JSON.parse(text) as { items: unknown[] }).items.length };
}

function stats(samples: number[]): Record<"min" | "median" | "p95" | "max" | "mean", string> {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? NaN;
  const fmt = (n: number) => n.toFixed(1);
  return {
    min: fmt(sorted[0] ?? NaN),
    median: fmt(at(0.5)),
    p95: fmt(at(0.95)),
    max: fmt(sorted[sorted.length - 1] ?? NaN),
    mean: fmt(samples.reduce((a, b) => a + b, 0) / samples.length),
  };
}

async function addStreamFollows(member: Member): Promise<void> {
  const page = (await (await fetch(`${API}/following`, { headers: { cookie: member.cookie } })).json()) as FollowingPage;
  const open = page.spaces
    .filter((s) => s.adapter === "civic_hub")
    .flatMap((s) => s.streams.filter((st) => st.status === "open" && st.rule === null));
  if (open.length < STREAM_FOLLOWS) throw new Error(`only ${open.length} open hub streams to follow`);
  for (const stream of open.slice(0, STREAM_FOLLOWS)) {
    const res = await fetch(`${API}/following/streams/${stream.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: member.cookie, origin: member.origin },
      body: JSON.stringify({ rule: "follow" }),
    });
    if (!res.ok) throw new Error(`stream follow: ${res.status} ${await res.text()}`);
  }
}

async function series(label: string, path: string, cookie?: string): Promise<string> {
  const primed = await timed(path, cookie);
  let primedAt = performance.now();
  for (let i = 0; i < WARMUP; i++) await timed(path, cookie);
  const samples: number[] = [];
  let last = primed;
  for (let i = 0; i < RUNS; i++) {
    if (performance.now() - primedAt > WARM_WINDOW_MS) {
      await timed(path, cookie);
      primedAt = performance.now();
    }
    last = await timed(path, cookie);
    samples.push(last.ms);
  }
  const s = stats(samples);
  return `| ${label} | ${RUNS} | ${s.min} | ${s.median} | ${s.mean} | ${s.p95} | ${s.max} | ${primed.ms.toFixed(1)} | ${last.items} | ${(last.bytes / 1024).toFixed(1)} |`;
}

async function main(): Promise<void> {
  await requireApi();
  const logs = new DidLogServer();
  await logs.start();
  try {
    // On a fresh database this first open resolves, stores and fetches every seed space (cold).
    const cold = await timed("/feed");
    const member = await logs.signIn();
    await timed("/feed", member.cookie); // copies any pending seeds
    await addStreamFollows(member);
    const exported = (await (await fetch(`${API}/me/export`, { headers: { cookie: member.cookie } })).json()) as {
      follows: Array<{ stream_key: string | null }>;
    };
    const follows = exported.follows.length;
    const streams = exported.follows.filter((f) => f.stream_key !== null).length;
    if (follows !== 20) throw new Error(`expected 20 follows, the member has ${follows}`);

    const rows = [
      await series("Member, Everything, first page", "/feed", member.cookie),
      await series("Member, Civic mode, first page (with panel)", "/feed?mode=civic", member.cookie),
      await series("Member, search \"vote\"", "/feed?q=vote", member.cookie),
      await series("Visitor, Everything, first page", "/feed"),
    ];
    console.log(`Follows: ${follows} (${follows - streams} spaces, ${streams} streams). Runs per row: ${RUNS} after ${WARMUP} warm-up.`);
    console.log(`First open of a fresh database (cold: resolve and fetch every seed from the recordings): ${cold.ms.toFixed(1)} ms`);
    console.log(`Node ${process.version}, ${os.cpus().length} x ${os.cpus()[0]?.model ?? "CPU"}, ${new Date().toISOString()}`);
    console.log("");
    console.log("| Request | Runs | Min ms | Median ms | Mean ms | p95 ms | Max ms | Priming ms | Items | KiB |");
    console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const row of rows) console.log(row);
  } finally {
    await logs.close();
  }
}

await main();
