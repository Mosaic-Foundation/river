// The shape ADR-004 asks for, read from the live catalog as the app roles themselves: two roles
// with no way around row-level security, each limited to its own schema, and every river table
// with ENABLE and FORCE ROW LEVEL SECURITY and at least one policy.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forIdentity, forInstance } from "../../../src/db/context.js";
import { RIVER_TABLES } from "../../../src/db/tables.js";
import { IDENTITY_URL, RIVER_URL, SEED_INSTANCE, refusal, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);
const identity = rolePool(IDENTITY_URL);

beforeAll(async () => {
  await requireDatabase(river, "river_app");
  await requireDatabase(identity, "identity_app");
});

afterAll(async () => {
  await river.end();
  await identity.end();
});

describe("database roles", () => {
  it("each app connects as its own role, never postgres", async () => {
    const r = await forInstance(SEED_INSTANCE, (db) => db.query("SELECT current_user AS who"), river);
    const i = await forIdentity((db) => db.query("SELECT current_user AS who"), identity);
    expect(r.rows[0].who).toBe("river_app");
    expect(i.rows[0].who).toBe("identity_app");
  });

  it("neither role can bypass row-level security or create roles, databases or replicas", async () => {
    const { rows } = await river.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
         FROM pg_roles WHERE rolname IN ('river_app', 'identity_app') ORDER BY rolname`,
    );
    expect(rows).toEqual([
      { rolname: "identity_app", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false },
      { rolname: "river_app", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false },
    ]);
  });

  it("each role has USAGE on its own schema only, and Supabase's API roles on neither", async () => {
    const { rows } = await river.query(
      `SELECT r AS role, s AS schema, has_schema_privilege(r, s, 'USAGE') AS usage
         FROM unnest(ARRAY['river_app', 'identity_app', 'anon', 'authenticated', 'service_role']) r,
              unnest(ARRAY['river', 'identity']) s
        WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
        ORDER BY 1, 2`,
    );
    const usage = rows.filter((row) => row.usage).map((row) => `${row.role}:${row.schema}`);
    expect(usage).toEqual(["identity_app:identity", "river_app:river"]);
  });

  it("river_app's table privileges are all in the river schema; identity_app has none there", async () => {
    const privileged = `
      SELECT DISTINCT n.nspname AS schema
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND has_table_privilege(c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
         AND has_schema_privilege(n.oid, 'USAGE')`;
    const r = await river.query(privileged);
    const i = await identity.query(privileged);
    expect(r.rows.map((row) => row.schema)).toEqual(["river"]);
    expect(i.rows.map((row) => row.schema)).not.toContain("river");
  });
});

describe("river schema", () => {
  it("has exactly the tables src/db/tables.ts lists, each with ENABLE and FORCE RLS and a policy", async () => {
    const { rows } = await river.query(
      `SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c
        WHERE c.relnamespace = 'river'::regnamespace AND c.relkind IN ('r', 'p')
        ORDER BY c.relname`,
    );
    expect(rows.map((t) => t.name)).toEqual(Object.keys(RIVER_TABLES).sort());
    for (const table of rows) {
      expect(table, table.name).toMatchObject({ enabled: true, forced: true });
      expect(table.policies, table.name).toBeGreaterThan(0);
    }
  });

  it("every policy applies to river_app only", async () => {
    const { rows } = await river.query(
      `SELECT DISTINCT r.rolname
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         CROSS JOIN LATERAL unnest(p.polroles) AS role_oid
         LEFT JOIN pg_roles r ON r.oid = role_oid
        WHERE c.relnamespace = 'river'::regnamespace`,
    );
    expect(rows).toEqual([{ rolname: "river_app" }]);
  });

  it("holds the seed instance, whose default circles name only seed follows", async () => {
    const { rows } = await forInstance(
      SEED_INSTANCE,
      (db) => db.query("SELECT * FROM river.instances WHERE id = $1", [SEED_INSTANCE]),
      river,
    );
    expect(rows).toHaveLength(1);
    const seed = rows[0];
    expect(seed).toMatchObject({
      hostname: "river.mosaic.social",
      theme: "mosaic",
      modes_enabled: ["everything", "civic"],
      default_mode: "everything",
    });
    const follows = seed.seed_follows as Array<{ url: string; circles: string[] }>;
    const circles = seed.default_circles as Array<{ name: string; role?: string; members: string[] }>;
    expect(follows.map((f) => f.url)).toEqual([
      "https://demosville.civic.social",
      "https://floyd.civic.social",
      "https://longmont.civic.social",
      "@wearenew_public@mastodon.social",
      "@w3c@w3c.social",
      "@eff@mastodon.social",
      "@internetarchive@mastodon.archive.org",
      "@wikipedia@wikis.world",
      "@swf@socialwebfoundation.org",
    ]);
    expect(circles.map((c) => c.name)).toEqual(["Civic", "News and ideas", "Family", "Soccer", "Neighborhood"]);
    expect(circles.filter((c) => c.role === "civic").map((c) => c.name)).toEqual(["Civic"]);
    // The two lists agree: a follow's circles are exactly the circles that list it.
    for (const follow of follows) {
      const listing = circles.filter((c) => c.members.includes(follow.url)).map((c) => c.name);
      expect(listing, follow.url).toEqual(follow.circles);
    }
  });

  it("river_app can't write instance config", async () => {
    const { code, message } = await refusal(() =>
      forInstance(SEED_INSTANCE, (db) => db.query("UPDATE river.instances SET name = 'x'"), river),
    );
    expect(code).toBe("42501");
    expect(message).toMatch(/permission denied for table instances/);
  });
});
