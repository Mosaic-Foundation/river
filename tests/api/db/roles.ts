// Connections for the database tests, one per app role. They never connect as postgres: the
// point is to see what river_app and identity_app themselves can reach (acceptance check 27).
// The defaults are the local stack's (supabase/seed.sql); CI passes the same values explicitly.
import pg from "pg";
import type { ClientSource } from "../../../src/db/context.js";

export const RIVER_URL =
  process.env.TEST_RIVER_DATABASE_URL ?? "postgresql://river_app:local-only@127.0.0.1:54322/postgres";
export const IDENTITY_URL =
  process.env.TEST_IDENTITY_DATABASE_URL ??
  "postgresql://identity_app:local-only@127.0.0.1:54322/postgres";

/**
 * The local stack's postgres role, used ONLY by the daily-job test (the job runs as postgres under
 * pg_cron, and river_app can't execute it) and to count rows river_app can't see (check 23). App
 * code never connects as postgres; every isolation test runs as river_app.
 */
export const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** The seed instance (migration 20261020213536) and the second one supabase/seed.sql adds. */
export const SEED_INSTANCE = "00000000-0000-4000-8000-000000000001";
export const OTHER_INSTANCE = "00000000-0000-4000-8000-0000000000e2";

export function rolePool(url: string): pg.Pool & ClientSource {
  return new pg.Pool({ connectionString: url, max: 2 });
}

/** Fails with a message that says what to start, instead of a bare ECONNREFUSED. */
export async function requireDatabase(pool: pg.Pool, role: string): Promise<void> {
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Can't connect as ${role} (${reason}). Start the local stack with \`npx supabase start\` ` +
        "(or `npx supabase db reset` to re-apply migrations and supabase/seed.sql).",
    );
  }
}

/** Runs `fn`, expecting Postgres to refuse it; returns the error's SQLSTATE and message. */
export async function refusal(fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await fn();
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e.code ?? "", message: e.message ?? "" };
  }
  throw new Error("expected the database to refuse this, but it succeeded");
}
