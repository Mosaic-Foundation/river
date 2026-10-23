// Refresh on open (spec 4.5, F1). Before the feed answers, the River brings the followed spaces up
// to date within a 6 s response budget:
//
//   1. A followed name with no stored space yet (a seed follow on first visit) is resolved through
//      its adapter and stored.
//   2. Bluesky spaces are first narrowed to a capped, rotating subset (rotation.ts), so a member
//      who imported hundreds of accounts still gets an answer within the budget.
//      Each stale space is claimed with the one-statement UPDATE of spec 4.5. Only claimed spaces
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
import { adapterNamed, adaptersFor, resolveWith } from "../adapters/index.js";
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
import { chooseForRefresh } from "./rotation.js";
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
  /**
   * The real time in ms, for the Bluesky rotation: it compares with last_fetched_at, which the
   * database stamps with its own clock (not the adapters' TEST_CLOCK_NOW).
   */
  wallClock?: () => number;
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

type FullDeps = Required<Omit<RefreshDeps, "source" | "adapterFor">> & {
  source?: ClientSource;
  /** Adapters that take a followed name, tried in order (one when a test injects adapterFor). */
  adaptersFor: (input: string) => Adapter[];
};

function withDefaults(deps: RefreshDeps): FullDeps {
  const injected = deps.adapterFor;
  return {
    guard: deps.guard ?? getFetchGuard(),
    now: deps.now ?? riverNow(),
    budgetMs: deps.budgetMs ?? RESPONSE_BUDGET_MS,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    waitUntil: deps.waitUntil ?? ((promise) => vercelWaitUntil(promise)),
    wallClock: deps.wallClock ?? Date.now,
    adapterNamed: deps.adapterNamed ?? adapterNamed,
    adaptersFor: injected
      ? (input) => {
          const adapter = injected(input);
          return adapter ? [adapter] : [];
        }
      : (input) => adaptersFor(input),
    source: deps.source,
  };
}

const resolveFailures = new Map<string, number>();

/** Forgets failed resolves (tests). */
export function clearResolveFailures(): void {
  resolveFailures.clear();
}

/** Work started by one request, raced against the response budget. */
class Run {
  readonly report: RefreshReport = { claimed: [], created: [], finished: [], pending: [], unresolved: [] };
  private readonly tasks: Array<Promise<void>> = [];
  private readonly running = new Set<string>();

  constructor(
    private readonly instanceId: string,
    private readonly deps: FullDeps,
  ) {}

  private track(label: string, work: Promise<void>): void {
    this.running.add(label);
    this.tasks.push(
      work
        .catch((err: unknown) => {
          console.error(`River refresh: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => {
          this.running.delete(label);
        }),
    );
  }

  private async fetchClaimed(row: SpaceRow): Promise<void> {
    await refreshOne(this.instanceId, row, this.deps);
    this.report.finished.push(row.id);
  }

  /**
   * Claims the stale ones among stored spaces (one transaction) and starts fetching them. Bluesky
   * spaces are first narrowed to a capped, rotating subset (rotation.ts).
   */
  async addStored(rows: readonly SpaceRow[]): Promise<void> {
    const unique = [...new Map(rows.map((row) => [row.id, row])).values()].filter(
      (row) => this.deps.adapterNamed(row.adapter) !== undefined,
    );
    const chosen = chooseForRefresh(unique, this.deps.wallClock());
    for (const row of await claimAll(this.instanceId, chosen, this.deps)) {
      this.report.claimed.push(row.id);
      this.track(row.id, this.fetchClaimed(row));
    }
  }

  /** Resolves a followed name that has no space yet, stores it, then refreshes it. */
  addMissing(input: string): void {
    const candidates = this.deps.adaptersFor(input);
    if (candidates.length === 0) return; // samples are stored by migration; anything else isn't followable
    const failedAt = resolveFailures.get(input);
    if (failedAt !== undefined && Date.now() - failedAt < RESOLVE_RETRY_MS) return;
    this.track(
      `resolve ${input}`,
      (async () => {
        let row: SpaceRow;
        try {
          const preview = await resolveWith(candidates, input, { guard: this.deps.guard, now: this.deps.now });
          row = await forInstance(this.instanceId, (db) => upsertSpace(db, preview), this.deps.source);
        } catch (err) {
          resolveFailures.set(input, Date.now());
          this.report.unresolved.push({ input, reason: errorMessage(err) });
          return;
        }
        resolveFailures.delete(input);
        this.report.created.push(row.id);
        const [won] = await claimAll(this.instanceId, [row], this.deps);
        if (won) {
          this.report.claimed.push(won.id);
          await this.fetchClaimed(won);
        }
      })(),
    );
  }

  /** Waits for everything or the budget; what's left continues under waitUntil. */
  async finish(): Promise<RefreshReport> {
    if (this.tasks.length === 0) return this.report;
    const all = Promise.allSettled(this.tasks).then(() => undefined);
    let budgetOver = false;
    await Promise.race([all, this.deps.sleep(this.deps.budgetMs).then(() => (budgetOver = true))]);
    if (budgetOver && this.running.size > 0) {
      this.report.pending = [...this.running];
      this.deps.waitUntil(all);
    }
    return this.report;
  }
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
  const existing = await forInstance(instanceId, (db) => findSpaces(db, inputs), deps.source);
  const run = new Run(instanceId, deps);
  await run.addStored([...existing.values()]);
  for (const input of new Set(inputs)) if (!existing.has(input)) run.addMissing(input);
  return run.finish();
}

/** Refreshes stored spaces (claim, fetch, store) within the budget, as refreshFollowed does. */
export async function refreshSpaces(
  instanceId: string,
  rows: readonly SpaceRow[],
  options: RefreshDeps = {},
): Promise<RefreshReport> {
  const run = new Run(instanceId, withDefaults(options));
  await run.addStored(rows);
  return run.finish();
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
