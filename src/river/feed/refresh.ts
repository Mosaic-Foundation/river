// Refresh on open (spec 4.5, F1). Before the feed answers, the River brings the followed spaces up
// to date within a 6 s response budget:
//
//   1. A followed name with no stored space yet (a seed follow on first visit) is resolved through
//      its adapter and stored.
//   2. Each stale space is claimed with the one-statement UPDATE of spec 4.5. Only claimed spaces
//      are fetched, so two visitors (or members) opening the River within 120 s cause one upstream
//      fetch (check 24), and no space is fetched more often than every 120 s (spec 4.3).
//   3. Claimed spaces are fetched in parallel through the adapters and the fetch guard (6 s per
//      request, no retries). Each page is stored as it arrives, inside forInstance().
//   4. The lock is released and last_fetched_at set in `finally`, whatever happened.
//   5. When the budget ends first, the response goes out with what is stored and the remaining
//      work continues under waitUntil (@vercel/functions); its items appear on the next open.
//
// Errors never reach the reader: a failed fetch leaves a quiet note on the space (last_error).
import { waitUntil as vercelWaitUntil } from "@vercel/functions";
import { forInstance, type ClientSource } from "../../db/context.js";
import { getFetchGuard, type FetchGuard } from "../../shared/fetch/index.js";
import { AdapterError, ADAPTER_MESSAGES, type Adapter, type NormalizedItem } from "../../shared/items/index.js";
import { adapterFor, adapterNamed } from "../adapters/index.js";
import { riverNow } from "../clock.js";
import { findSpaces, type SpaceRow, toSpaceRecord } from "./spaces.js";
import {
  applySpaceResult,
  applyStreams,
  claim,
  knownSourceIds,
  markNotModified,
  recordFetchError,
  releaseClaim,
  storeItems,
  upsertSpace,
} from "./store.js";
import { checkWithdrawnStreams } from "./withdrawn.js";

/** The response budget (spec 4.5). */
export const RESPONSE_BUDGET_MS = 6_000;
/** After a failed resolve, this process waits this long before trying the same name again. */
export const RESOLVE_RETRY_MS = 120_000;

export interface RefreshDeps {
  guard?: FetchGuard;
  /** The adapters' clock (TEST_CLOCK_NOW in tests). */
  now?: Date;
  budgetMs?: number;
  /** Waits out the budget; tests pass fake timers' setTimeout through the default. */
  sleep?: (ms: number) => Promise<void>;
  /** Keeps work alive after the response (Vercel); a no-op elsewhere. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Adapter lookups, for tests. */
  adapterNamed?: (name: string) => Adapter | undefined;
  adapterFor?: (input: string) => Adapter | undefined;
  source?: ClientSource;
}

export interface RefreshReport {
  /** Spaces this request claimed and fetched (or is still fetching). */
  claimed: string[];
  /** Spaces created from followed names this request resolved. */
  created: string[];
  /** Spaces whose refresh finished within the budget. */
  finished: string[];
  /** Spaces still being fetched when the response went out (continuing under waitUntil). */
  pending: string[];
  /** Followed names that couldn't be resolved, with the F6 reason. */
  unresolved: Array<{ input: string; reason: string }>;
}

type FullDeps = Required<Omit<RefreshDeps, "source">> & { source?: ClientSource };

function withDefaults(deps: RefreshDeps): FullDeps {
  return {
    guard: deps.guard ?? getFetchGuard(),
    now: deps.now ?? riverNow(),
    budgetMs: deps.budgetMs ?? RESPONSE_BUDGET_MS,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    waitUntil: deps.waitUntil ?? ((promise) => vercelWaitUntil(promise)),
    adapterNamed: deps.adapterNamed ?? adapterNamed,
    adapterFor: deps.adapterFor ?? adapterFor,
    source: deps.source,
  };
}

const resolveFailures = new Map<string, number>();

/** Forgets failed resolves (tests). */
export function clearResolveFailures(): void {
  resolveFailures.clear();
}

/**
 * Refreshes the spaces behind `inputs` (followed names: seed follows, later a member's follows),
 * creating the ones that don't exist yet. Resolves when everything is done or the budget ends,
 * whichever is first; never throws for a source's failure.
 */
export async function refreshFollowed(
  instanceId: string,
  inputs: readonly string[],
  options: RefreshDeps = {},
): Promise<RefreshReport> {
  const deps = withDefaults(options);
  const report: RefreshReport = { claimed: [], created: [], finished: [], pending: [], unresolved: [] };
  const existing = await forInstance(instanceId, (db) => findSpaces(db, inputs), deps.source);

  const tasks: Array<Promise<void>> = [];
  const pending = new Set<string>();
  const track = (label: string, work: Promise<void>) => {
    pending.add(label);
    tasks.push(
      work
        .catch((err: unknown) => {
          console.error(`River refresh: ${label}: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => {
          pending.delete(label);
          if (!label.startsWith("resolve:")) report.finished.push(label);
        }),
    );
  };

  // Stale stored spaces: claim them all in one transaction, then fetch each claimed one.
  const stored = [...new Map([...existing.values()].map((row) => [row.id, row])).values()].filter(
    (row) => deps.adapterNamed(row.adapter) !== undefined,
  );
  const claimed = await claimAll(instanceId, stored, deps);
  for (const row of claimed) {
    report.claimed.push(row.id);
    track(row.id, refreshOne(instanceId, row, deps));
  }

  // Followed names with no space yet: resolve, store, then refresh like any other.
  const now = Date.now();
  for (const input of inputs) {
    if (existing.has(input)) continue;
    const adapter = deps.adapterFor(input);
    if (!adapter) continue; // samples are stored by migration; anything else isn't followable
    const failedAt = resolveFailures.get(input);
    if (failedAt !== undefined && now - failedAt < RESOLVE_RETRY_MS) continue;
    track(
      `resolve:${input}`,
      (async () => {
        let row: SpaceRow;
        try {
          const preview = await adapter.resolve(input, { guard: deps.guard, now: deps.now });
          row = await forInstance(instanceId, (db) => upsertSpace(db, preview), deps.source);
        } catch (err) {
          resolveFailures.set(input, Date.now());
          report.unresolved.push({ input, reason: errorMessage(err) });
          return;
        }
        resolveFailures.delete(input);
        report.created.push(row.id);
        const [won] = await claimAll(instanceId, [row], deps);
        if (won) {
          report.claimed.push(won.id);
          await refreshOne(instanceId, won, deps);
          report.finished.push(won.id);
        }
      })(),
    );
  }

  if (tasks.length === 0) return report;
  const all = Promise.allSettled(tasks).then(() => undefined);
  let budgetOver = false;
  await Promise.race([all, deps.sleep(deps.budgetMs).then(() => (budgetOver = true))]);
  if (budgetOver && pending.size > 0) {
    report.pending = [...pending];
    deps.waitUntil(all);
  }
  return report;
}

async function claimAll(instanceId: string, rows: readonly SpaceRow[], deps: FullDeps): Promise<SpaceRow[]> {
  if (rows.length === 0) return [];
  return forInstance(
    instanceId,
    async (db) => {
      const won: SpaceRow[] = [];
      for (const row of rows) if (await claim(db, row.id)) won.push(row);
      return won;
    },
    deps.source,
  );
}

function errorMessage(err: unknown): string {
  return err instanceof AdapterError ? err.message : ADAPTER_MESSAGES.unreachable;
}

/** Fetches one claimed space and writes what came back. Always releases the claim. */
export async function refreshSpace(instanceId: string, space: SpaceRow, options: RefreshDeps = {}): Promise<void> {
  return refreshOne(instanceId, space, withDefaults(options));
}

async function refreshOne(instanceId: string, space: SpaceRow, deps: FullDeps): Promise<void> {
  const db = <T>(fn: Parameters<typeof forInstance<T>>[1]) => forInstance(instanceId, fn, deps.source);
  try {
    const adapter = deps.adapterNamed(space.adapter);
    if (!adapter) return;
    let known: Set<string> | undefined;
    const fetched: NormalizedItem[] = [];
    const result = await adapter.fetchNew(toSpaceRecord(space), {
      guard: deps.guard,
      now: deps.now,
      isKnown: async (sourceId) => {
        known ??= await db((tx) => knownSourceIds(tx, space.id));
        return known.has(sourceId);
      },
      onPage: async (items) => {
        fetched.push(...items);
        await db((tx) => storeItems(tx, space.id, items));
      },
    });
    if (result.notModified) {
      await db((tx) => markNotModified(tx, space.id));
      return;
    }
    // Items an adapter returned without passing through onPage are stored here too.
    const stored = new Set(fetched.map((item) => item.sourceId));
    const unseen = result.items.filter((item) => !stored.has(item.sourceId));
    await db(async (tx) => {
      if (unseen.length) await storeItems(tx, space.id, unseen);
      await applySpaceResult(tx, space, result);
      await applyStreams(tx, space.id, result.items, result.streams);
    });
    if (space.adapter === "civic_hub") {
      await checkWithdrawnStreams(space, { instanceId, guard: deps.guard, now: deps.now, source: deps.source });
    }
  } catch (err) {
    const blocked = err instanceof AdapterError && err.reason === "server_only";
    await db((tx) => recordFetchError(tx, space.id, blocked ? "blocked" : "error", errorMessage(err)));
  } finally {
    await db((tx) => releaseClaim(tx, space.id));
  }
}
