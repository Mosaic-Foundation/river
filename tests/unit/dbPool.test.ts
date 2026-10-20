import { afterEach, describe, expect, it } from "vitest";
import { closePool, connectionConfig, getPool, POOL_MAX } from "../../src/db/pool.js";

const saved = process.env.DATABASE_URL;

afterEach(async () => {
  await closePool();
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

describe("db pool", () => {
  it("needs DATABASE_URL only when first used", () => {
    delete process.env.DATABASE_URL;
    expect(() => getPool()).toThrow(/DATABASE_URL/);
  });

  it("is one small pool per process, created without connecting", () => {
    // Nothing listens here; creating the pool must not open a connection.
    process.env.DATABASE_URL = "postgresql://river_app:x@127.0.0.1:1/postgres";
    const pool = getPool();
    expect(POOL_MAX).toBe(3);
    expect(pool.options.max).toBe(3);
    expect(getPool()).toBe(pool);
    expect(pool.totalCount).toBe(0);
  });
});

describe("db connection TLS", () => {
  const POOLER = "postgresql://river_app.ref:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";
  const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

  it("leaves the local stack in plain text", () => {
    const local = "postgresql://river_app:local-only@127.0.0.1:54322/postgres";
    expect(connectionConfig(local)).toEqual({ connectionString: local, ssl: false });
    expect(connectionConfig("postgresql://u:p@localhost:5432/db?sslmode=disable").ssl).toBe(false);
  });

  it("verifies certificate and hostname for any other host, even without sslmode", () => {
    expect(connectionConfig(POOLER)).toEqual({
      connectionString: POOLER,
      ssl: { rejectUnauthorized: true },
    });
  });

  it("reads sslmode itself, so pg can't override the ssl option, and never weakens it", () => {
    for (const mode of ["require", "verify-ca", "verify-full"]) {
      const config = connectionConfig(`${POOLER}?sslmode=${mode}`, CA);
      expect(config.connectionString).toBe(POOLER);
      expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: CA });
    }
  });

  it("refuses modes and parameters that would skip or move verification", () => {
    expect(() => connectionConfig(`${POOLER}?sslmode=disable`)).toThrow(/only for a local database/);
    for (const mode of ["prefer", "allow", "no-verify"]) {
      expect(() => connectionConfig(`${POOLER}?sslmode=${mode}`)).toThrow(/not supported/);
    }
    for (const param of ["uselibpqcompat=true", "sslrootcert=/tmp/ca.pem", "ssl=true"]) {
      expect(() => connectionConfig(`${POOLER}?${param}`)).toThrow(/remove/);
    }
  });

  it("never puts the URL (and its password) in an error", () => {
    const secret = "postgresql://river_app:hunter2@db.example:6543/postgres?sslmode=prefer";
    expect(() => connectionConfig(secret)).toThrow(/^(?!.*hunter2)/);
    expect(() => connectionConfig("not a url hunter2")).toThrow(/^(?!.*hunter2)/);
    expect(() => connectionConfig("mysql://u:hunter2@h/db")).toThrow(/postgresql/);
  });

  it("passes the CA and TLS to the pool", () => {
    process.env.DATABASE_URL = POOLER;
    process.env.DATABASE_CA_CERT = CA.replaceAll("\n", "\\n");
    try {
      expect(getPool().options.ssl).toEqual({ rejectUnauthorized: true, ca: CA });
    } finally {
      delete process.env.DATABASE_CA_CERT;
    }
  });
});
