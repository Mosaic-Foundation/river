// The one node-postgres pool. Only files under src/db/ may import `pg` (enforced by
// eslint.config.js); everything else goes through forInstance(), forAccount() or forIdentity()
// in ./context.ts.
//
// Both apps connect through Supabase's transaction pooler (port 6543) as river_app or
// identity_app (ADR-004). Transaction mode cannot hold prepared statements, so no query ever
// passes a `name`: context.ts only exposes query(text, values). Serverless functions each keep
// their own pool, so it stays small.
//
// TLS. pg 8 reads `sslmode` from the URL and lets it override any `ssl` option passed beside it;
// it treats require, prefer and verify-ca as verify-full (with a warning), and pg 9 will switch
// them to libpq's meaning, where require encrypts without checking the certificate. So the URL's
// TLS parameters are read here instead and turned into an explicit `ssl` option that always
// verifies the server: any host but loopback gets TLS with certificate and hostname checks, and
// DATABASE_CA_CERT supplies the CA when the server's chain isn't in Node's store. Nothing here can
// turn verification off.
import pg from "pg";
import type { ConnectionOptions } from "node:tls";
import { env } from "../config/env.js";

export const POOL_MAX = 3;

let pool: pg.Pool | undefined;

/** Lazy: created on first use, so the apps start and answer /health without DATABASE_URL. */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      ...connectionConfig(env.databaseUrl, env.databaseCaCert),
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

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const VERIFYING_MODES = new Set(["require", "verify-ca", "verify-full"]);
/** TLS parameters pg would read from the URL itself; this module owns TLS instead. */
const REFUSED_PARAMS = ["ssl", "sslcert", "sslkey", "sslrootcert", "sslnegotiation", "uselibpqcompat"];

export interface ConnectionConfig {
  connectionString: string;
  ssl: false | ConnectionOptions;
}

/**
 * Turns DATABASE_URL (and an optional CA certificate, PEM) into pg's connection options.
 * - No sslmode: TLS with full verification, except on loopback (the local Supabase stack).
 * - sslmode=require, verify-ca or verify-full: TLS with full verification.
 * - sslmode=disable: loopback only.
 * - Any other sslmode, or a file-based TLS parameter, is refused with a message saying why.
 * Messages never include the URL, which carries the password.
 */
export function connectionConfig(databaseUrl: string, caCert?: string): ConnectionConfig {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must start with postgresql://");
  }
  for (const name of REFUSED_PARAMS) {
    if (url.searchParams.has(name)) {
      throw new Error(
        `DATABASE_URL: remove "${name}"; TLS is set by sslmode, with DATABASE_CA_CERT for the CA`,
      );
    }
  }

  const loopback = LOOPBACK.has(url.hostname);
  const mode = url.searchParams.get("sslmode") ?? (loopback ? "disable" : "verify-full");
  url.searchParams.delete("sslmode");
  const connectionString = url.toString();

  if (mode === "disable") {
    if (!loopback) {
      throw new Error("DATABASE_URL: sslmode=disable is allowed only for a local database");
    }
    return { connectionString, ssl: false };
  }
  if (!VERIFYING_MODES.has(mode)) {
    throw new Error(`DATABASE_URL: sslmode=${mode} is not supported; use verify-full`);
  }
  const ssl: ConnectionOptions = { rejectUnauthorized: true };
  if (caCert !== undefined) ssl.ca = caCert;
  return { connectionString, ssl };
}
