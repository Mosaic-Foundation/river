// The follow cap (security review of 3a86e8f, item 3): an account follows at most MAX_FOLLOWS
// spaces and streams, enforced inside the follow's own transaction (the follow box, a stream rule,
// an import), so a refusal stores nothing, and two imports at once can't both slip under it. Runs
// as river_app against the local database with spaces of its own (never fetched).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forAccount, forInstance } from "../../../src/db/context.js";
import type { SpacePreview } from "../../../src/shared/items/index.js";
import type { SpaceRow } from "../../../src/river/feed/spaces.js";
import { upsertSpaces } from "../../../src/river/feed/store.js";
import {
  ensureStream,
  FollowingError,
  followPreview,
  followSpaces,
  MAX_FOLLOWS,
  setStreamRule,
} from "../../../src/river/following/service.js";
import { RIVER_URL, SEED_INSTANCE, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);

beforeAll(async () => {
  await requireDatabase(river, "river_app");
});

afterAll(async () => {
  await river.end();
});

function preview(url: string): SpacePreview {
  return { adapter: "civic_hub", canonicalUrl: url, name: "Follow cap test", feedUrl: `${url}/events`, category: "civic", manifest: {} };
}

/** `n` new spaces nobody follows. */
async function newSpaces(n: number): Promise<SpaceRow[]> {
  const batch = randomUUID();
  const previews = Array.from({ length: n }, (_, i) => preview(`https://follow-cap.invalid/${batch}/${i}`));
  return forInstance(SEED_INSTANCE, (db) => upsertSpaces(db, previews), river);
}

async function newMember(): Promise<string> {
  const accountId = randomUUID();
  await forAccount(SEED_INSTANCE, accountId, (db) => db.insert("accounts", { id: accountId }), river);
  return accountId;
}

function as<T>(accountId: string, fn: Parameters<typeof forAccount<T>>[2]): Promise<T> {
  return forAccount(SEED_INSTANCE, accountId, fn, river);
}

async function followCount(accountId: string): Promise<number> {
  return as(accountId, async (db) => {
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM river.follows WHERE rule = 'follow' AND ended_at IS NULL",
    );
    return rows[0]?.n ?? 0;
  });
}

async function refusal(fn: () => Promise<unknown>): Promise<FollowingError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof FollowingError) return err;
    throw err;
  }
  throw new Error("expected a FollowingError");
}

describe("the follow cap", () => {
  it("lets an account reach 2,000 follows and refuses the next, by the follow box, a stream or an import", async () => {
    expect(MAX_FOLLOWS).toBe(2000);
    const spaces = await newSpaces(MAX_FOLLOWS + 3);
    const member = await newMember();
    const ids = spaces.map((s) => s.id);
    await as(member, (db) => followSpaces(db, ids.slice(0, MAX_FOLLOWS), []));
    expect(await followCount(member)).toBe(MAX_FOLLOWS);

    const extra = spaces[MAX_FOLLOWS] as SpaceRow;
    const byBox = await refusal(() =>
      as(member, (db) => followPreview(db, preview(extra.canonical_url), { scope: "space", circleIds: [] })),
    );
    expect(byBox.status).toBe(409);
    expect(byBox.code).toBe("follow_limit");
    expect(byBox.message).toContain("2,000");

    const streamId = await as(member, (db) => ensureStream(db, extra.id, `cap-${randomUUID()}`));
    expect((await refusal(() => as(member, (db) => setStreamRule(db, streamId, "follow")))).code).toBe("follow_limit");
    // A mute isn't a follow.
    await as(member, (db) => setStreamRule(db, streamId, "mute"));

    const byImport = await refusal(() => as(member, (db) => followSpaces(db, ids.slice(MAX_FOLLOWS), [])));
    expect(byImport.code).toBe("follow_limit");
    expect(byImport.message).toContain("room for 0 more");
    expect(await followCount(member)).toBe(MAX_FOLLOWS);

    // Following one already followed again is fine.
    await as(member, (db) => followSpaces(db, ids.slice(0, 5), []));
  }, 60_000);

  it("refuses a whole import that would pass the cap, storing none of it", async () => {
    const spaces = await newSpaces(MAX_FOLLOWS + 1);
    const member = await newMember();
    await as(member, (db) => followSpaces(db, spaces.slice(0, 10).map((s) => s.id), []));
    const err = await refusal(() => as(member, (db) => followSpaces(db, spaces.slice(10).map((s) => s.id), [])));
    expect(err.message).toContain("room for 1,990 more");
    expect(await followCount(member)).toBe(10);
  }, 60_000);

  it("two imports at once can't both slip under the cap", async () => {
    const spaces = await newSpaces(3000);
    const member = await newMember();
    const results = await Promise.allSettled([
      as(member, (db) => followSpaces(db, spaces.slice(0, 1500).map((s) => s.id), [])),
      as(member, (db) => followSpaces(db, spaces.slice(1500).map((s) => s.id), [])),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await followCount(member)).toBe(1500);
  }, 60_000);
});
