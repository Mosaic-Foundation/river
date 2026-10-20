// The only way app code queries Postgres (CLAUDE.md constraint 2, ADR-004). Each call opens a
// transaction on a pooled client, sets the request's settings with set_config(name, value, true)
// so they last only for that transaction (SET cannot take bind parameters, so ids are never
// spliced into SQL text), runs the callback, and commits, or rolls back if it throws. Row-level
// security policies read the settings with current_setting('app.instance_id', true) and
// current_setting('app.account_id', true).
//
// forInstance() and forAccount() also give the callback insert(), which stamps the context's
// instance and account ids on the row (spec 3) and refuses a row that carries another instance's
// or account's id before anything reaches the database. The policies refuse the same rows again
// for anything written with plain query(), so the database holds the line on its own.
import type { QueryResult, QueryResultRow } from "pg";
import { getPool } from "./pool.js";
import { RIVER_TABLES, isRiverTable, type RiverTable } from "./tables.js";

/** What a callback gets: text and bind values only, so no query can carry a statement name. */
export interface Db {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

/** A row to insert: column name to value. Pass jsonb values as JSON.stringify(...) text. */
export type Row = Readonly<Record<string, unknown>>;

/** What forInstance() and forAccount() callbacks get. */
export interface RiverDb extends Db {
  /**
   * Inserts one row into a river table and returns it. Stamps instance_id (and account_id for a
   * member's own tables) from the context; throws ForeignIdError if the row names another.
   */
  insert<R extends QueryResultRow = QueryResultRow>(table: RiverTable, row: Row): Promise<R>;
}

/** The transaction-local settings RLS policies read. */
export type SettingName = "app.instance_id" | "app.account_id";

/** The slice of pg.PoolClient this module uses. */
export interface TxClient {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(destroy?: Error | boolean): void;
}

/** The slice of pg.Pool this module uses; tests pass a fake, or a pool for another role. */
export interface ClientSource {
  connect(): Promise<TxClient>;
}

/** A payload carried an instance or account id other than the context's. Nothing was written. */
export class ForeignIdError extends Error {
  constructor(
    readonly table: string,
    readonly column: "instance_id" | "account_id",
  ) {
    super(`Refused a river.${table} row whose ${column} is not this context's`);
    this.name = "ForeignIdError";
  }
}

interface Scope {
  instanceId: string;
  accountId?: string;
}

/** Rows visible to one instance: shared public tables plus the instance's own rows. */
export async function forInstance<T>(
  instanceId: string,
  fn: (db: RiverDb) => Promise<T>,
  source?: ClientSource,
): Promise<T> {
  const scope = { instanceId: requireId("instanceId", instanceId) };
  return inTransaction(
    [["app.instance_id", scope.instanceId]],
    (db) => fn(riverDb(db, scope)),
    source,
  );
}

/** Rows visible to one member of one instance: their follows, circles, read state, preferences. */
export async function forAccount<T>(
  instanceId: string,
  accountId: string,
  fn: (db: RiverDb) => Promise<T>,
  source?: ClientSource,
): Promise<T> {
  const scope = {
    instanceId: requireId("instanceId", instanceId),
    accountId: requireId("accountId", accountId),
  };
  return inTransaction(
    [
      ["app.instance_id", scope.instanceId],
      ["app.account_id", scope.accountId],
    ],
    (db) => fn(riverDb(db, scope)),
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

/**
 * Applies the context to a row bound for `table`: refuses another instance's or account's id,
 * then stamps the context's ids on the tables that carry them. Exported for unit tests.
 */
export function stampRow(table: RiverTable, row: Row, scope: Scope): Record<string, unknown> {
  const kind = RIVER_TABLES[table];
  if (kind === "config") {
    throw new Error(`river.${table} is written by migrations only`);
  }
  refuseForeign(table, row, "instance_id", scope.instanceId);
  refuseForeign(table, row, "account_id", scope.accountId);

  const stamped: Record<string, unknown> = { ...row };
  if (kind === "instance" || kind === "account") {
    stamped.instance_id = scope.instanceId;
  }
  if (kind === "account") {
    if (scope.accountId === undefined) {
      throw new Error(`river.${table} rows belong to an account; write them inside forAccount()`);
    }
    stamped.account_id = scope.accountId;
  }
  return stamped;
}

function refuseForeign(
  table: RiverTable,
  row: Row,
  column: "instance_id" | "account_id",
  expected: string | undefined,
): void {
  const value = row[column];
  if (value === undefined || value === null) return;
  if (expected === undefined || String(value).toLowerCase() !== expected) {
    throw new ForeignIdError(table, column);
  }
}

const COLUMN = /^[a-z_][a-z0-9_]*$/;

function riverDb(db: Db, scope: Scope): RiverDb {
  return {
    query: db.query,
    async insert<R extends QueryResultRow>(table: RiverTable, row: Row): Promise<R> {
      // Table and column names are the only text that enters the SQL, and both are checked here:
      // the table against the known list (callers may not be typed), columns against a strict
      // identifier pattern. Every value is a bind parameter.
      if (!isRiverTable(table)) throw new Error(`Unknown river table: ${String(table)}`);
      const entries = Object.entries(stampRow(table, row, scope)).filter(([, v]) => v !== undefined);
      for (const [column] of entries) {
        if (!COLUMN.test(column)) throw new Error(`Invalid column name: ${JSON.stringify(column)}`);
      }
      const text =
        entries.length === 0
          ? `INSERT INTO river."${table}" DEFAULT VALUES RETURNING *`
          : `INSERT INTO river."${table}" (${entries.map(([c]) => `"${c}"`).join(", ")}) ` +
            `VALUES (${entries.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`;
      const result = await db.query<R>(text, entries.map(([, v]) => v));
      return result.rows[0] as R;
    },
  };
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Ids are uuids (the policies cast the settings to uuid); returns the lowercase form. */
function requireId(label: string, value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  const id = value.toLowerCase();
  if (!UUID.test(id)) {
    throw new Error(`${label} must be a uuid`);
  }
  return id;
}
