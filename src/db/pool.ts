// The one node-postgres pool. Only files under src/db/ may import `pg` (enforced by
// eslint.config.js); everything else goes through forInstance(), forAccount() or forIdentity()
// in ./context.ts.
//
// Both apps connect through Supabase's transaction pooler (port 6543) as river_app or
// identity_app (ADR-004). Transaction mode cannot hold prepared statements, so no query ever
// passes a `name`: context.ts only exposes query(text, values). Serverless functions each keep
// their own pool, so it stays small.
import pg from "pg";
import { env } from "../config/env.js";

export const POOL_MAX = 3;

let pool: pg.Pool | undefined;

/** Lazy: created on first use, so the apps start and answer /health without DATABASE_URL. */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.databaseUrl,
      max: POOL_MAX,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    // An idle client can drop (pooler restart, network); log it without the connection string.
    pool.on("error", (err) => {
      console.error(`Postgres pool error: ${err.message}`);
    });
  }
  return pool;
}

/** Closes the pool, for tests and scripts. */
export async function closePool(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.end();
}
