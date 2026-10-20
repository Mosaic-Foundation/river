// The only way app code queries Postgres (CLAUDE.md constraint 2, ADR-004). Each call opens a
// transaction on a pooled client, sets the request's settings with set_config(name, value, true)
// so they last only for that transaction (SET cannot take bind parameters, so ids are never
// spliced into SQL text), runs the callback, and commits, or rolls back if it throws. Row-level
// security policies read the settings with current_setting('app.instance_id', true) and
// current_setting('app.account_id', true).
//
// M0 stubs: transaction and settings only. M1 adds the schemas, stamping instance and account
// ids on insert, and refusing a payload that carries another instance's or account's id.
import type { QueryResult, QueryResultRow } from "pg";
import { getPool } from "./pool.js";

/** What a callback gets: text and bind values only, so no query can carry a statement name. */
export interface Db {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

/** The transaction-local settings RLS policies read. */
export type SettingName = "app.instance_id" | "app.account_id";

/** The slice of pg.PoolClient this module uses. */
export interface TxClient {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(destroy?: Error | boolean): void;
}

/** The slice of pg.Pool this module uses; tests pass a fake. */
export interface ClientSource {
  connect(): Promise<TxClient>;
}

/** Rows visible to one instance: shared public tables plus the instance's own rows. */
export async function forInstance<T>(
  instanceId: string,
  fn: (db: Db) => Promise<T>,
  source?: ClientSource,
): Promise<T> {
  return inTransaction([["app.instance_id", requireId("instanceId", instanceId)]], fn, source);
}

/** Rows visible to one member of one instance: their follows, circles, read state, preferences. */
export async function forAccount<T>(
  instanceId: string,
  accountId: string,
  fn: (db: Db) => Promise<T>,
  source?: ClientSource,
): Promise<T> {
  return inTransaction(
    [
      ["app.instance_id", requireId("instanceId", instanceId)],
      ["app.account_id", requireId("accountId", accountId)],
    ],
    fn,
    source,
  );
}

/**
 * The identity host's queries, as identity_app on the identity schema. The identity tables arrive
 * in M7, which decides which settings their policies read; until then this sets none.
 */
export async function forIdentity<T>(fn: (db: Db) => Promise<T>, source?: ClientSource): Promise<T> {
  return inTransaction([], fn, source);
}

async function inTransaction<T>(
  settings: ReadonlyArray<readonly [SettingName, string]>,
  fn: (db: Db) => Promise<T>,
  source: ClientSource = getPool(),
): Promise<T> {
  const client = await source.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    if (settings.length > 0) {
      // Names and values are both bind parameters: set_config($1, $2, true), ...
      const calls = settings.map((_, i) => `set_config($${2 * i + 1}, $${2 * i + 2}, true)`);
      await client.query(`SELECT ${calls.join(", ")}`, settings.flat());
    }
    const db: Db = {
      query: (text, values) => client.query(text, values ? [...values] : undefined) as never,
    };
    const result = await fn(db);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // A client that can't roll back must not go back to the pool with an open transaction.
      broken = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
    }
    throw err;
  } finally {
    client.release(broken);
  }
}

function requireId(label: string, value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value;
}
