// Row-level security hardening (security review of 3a86e8f, item 7; migration
// 20261026171000_row_security_hardening.sql), as river_app: an UPDATE on accounts needs an account
// in context and reaches only that row; spaces and streams can be updated only in the columns the
// refresh and the follow box write; loadViewer() asks for its own account by id. Every change here
// runs in a transaction that is rolled back (the callback throws), so the shared rows stay as
// they were.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forAccount, forInstance, type RiverDb } from "../../../src/db/context.js";
import { loadViewer } from "../../../src/river/accounts.js";
import { ADMIN_URL, RIVER_URL, SEED_INSTANCE, refusal, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

/** Runs `fn` in a forInstance() or forAccount() transaction and rolls it back; returns fn's value. */
async function rolledBack<T>(accountId: string | null, fn: (db: RiverDb) => Promise<T>): Promise<T> {
  try {
    const run = async (db: RiverDb) => {
      throw new Rollback(await fn(db));
    };
    if (accountId) await forAccount(SEED_INSTANCE, accountId, run, river);
    else await forInstance(SEED_INSTANCE, run, river);
  } catch (err) {
    if (err instanceof Rollback) return err.value as T;
    throw err;
  }
  throw new Error("unreachable");
}

async function newAccount(name: string): Promise<string> {
  const id = randomUUID();
  await forAccount(SEED_INSTANCE, id, (db) => db.insert("accounts", { id, display_name: name }), river);
  return id;
}

let member: string;
let other: string;
let spaceId: string;

beforeAll(async () => {
  await requireDatabase(river, "river_app");
  member = await newAccount("Row security A");
  other = await newAccount("Row security B");
  spaceId = await forInstance(
    SEED_INSTANCE,
    async (db) =>
      (
        await db.insert<{ id: string }>("spaces", {
          adapter: "civic_hub",
          canonical_url: `https://row-security.invalid/${randomUUID()}`,
          feed_url: "https://row-security.invalid/events",
          category: "civic",
          name: "Row security test",
        })
      ).id,
    river,
  );
  await forInstance(SEED_INSTANCE, (db) => db.query("INSERT INTO river.streams (space_id, key) VALUES ($1, 'k')", [spaceId]), river);
});

afterAll(async () => {
  await river.end();
  await admin.end();
});

describe("accounts: UPDATE needs an account in context", () => {
  it("reaches no account from an instance-only transaction", async () => {
    const changed = await rolledBack(null, async (db) => (await db.query("UPDATE river.accounts SET display_name = 'x'")).rowCount);
    expect(changed).toBe(0);
  });

  it("reaches only the member's own row from theirs", async () => {
    const rows = await rolledBack(member, async (db) => {
      await db.query("UPDATE river.accounts SET display_name = 'renamed'");
      return (await db.query<{ id: string }>("SELECT id FROM river.accounts WHERE display_name = 'renamed'")).rows;
    });
    expect(rows).toEqual([{ id: member }]);
    const moved = await rolledBack(member, async (db) => (await db.query("UPDATE river.accounts SET display_name = 'x' WHERE id = $1", [other])).rowCount);
    expect(moved).toBe(0);
  });

  it("still lets the hostname and sign-in paths read and insert as before", async () => {
    const seen = await rolledBack(null, async (db) => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM river.accounts")).rows[0]!.n);
    expect(seen).toBeGreaterThanOrEqual(2);
  });
});

describe("spaces and streams: UPDATE only in the columns the code writes", () => {
  it.each([
    ["spaces", "canonical_url = 'https://evil.example/'"],
    ["spaces", "adapter = 'rss'"],
    ["spaces", "feed_url = 'https://evil.example/feed'"],
    ["spaces", "home_url = 'https://evil.example/'"],
    ["streams", "key = 'other'"],
    ["streams", "space_id = space_id"],
  ])("refuses river.%s SET %s", async (table, set) => {
    const where = table === "spaces" ? "id = $1" : "space_id = $1";
    const { code } = await refusal(() => rolledBack(null, (db) => db.query(`UPDATE river.${table} SET ${set} WHERE ${where}`, [spaceId])));
    expect(code).toBe("42501");
  });

  it("still allows what the refresh and the follow box write", async () => {
    const changed = await rolledBack(null, async (db) => {
      const a = await db.query(
        `UPDATE river.spaces SET etag = 'e', etag_url = 'u', newest_item_at = now(), manifest = '{}', name = 'n',
           icon_url = NULL, fetch_status = 'ok', last_error = NULL, error_count = 0,
           fetch_lock_until = NULL, last_fetched_at = now() WHERE id = $1`,
        [spaceId],
      );
      const b = await db.query(
        "UPDATE river.streams SET title = 't', status = 'ended', ended_at = now(), last_checked_at = now() WHERE space_id = $1",
        [spaceId],
      );
      return (a.rowCount ?? 0) + (b.rowCount ?? 0);
    });
    expect(changed).toBe(2);
  });
});

describe("loadViewer asks for its own account by id", () => {
  it("returns nothing for an unknown account even where row security doesn't filter", async () => {
    // As postgres (which bypasses row security), the query alone decides which row comes back.
    expect(await loadViewer(SEED_INSTANCE, randomUUID(), admin)).toBeUndefined();
    expect((await loadViewer(SEED_INSTANCE, member, admin))?.accountId).toBe(member);
    expect((await loadViewer(SEED_INSTANCE, member, river))?.displayName).toBe("Row security A");
  });
});
