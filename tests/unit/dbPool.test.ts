import { afterEach, describe, expect, it } from "vitest";
import { closePool, getPool, POOL_MAX } from "../../src/db/pool.js";

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
