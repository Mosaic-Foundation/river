// No cross-schema code: River SQL never names the identity schema or role, and identity SQL never
// names the river schema or role, so Mosaic ID can leave this repository and later this database
// (docs/identity-database-move.md). Checked statically here; tests/api/db/dailyJob.test.ts checks
// the functions and pg_cron jobs as they stand in the database.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** Merged migrations that touch both schemas. They can't be edited; later ones may not mix. */
const MIXED_BEFORE_THE_SPLIT = new Set([
  "20261020213532_roles_and_schemas.sql", // creates both schemas and both roles
  "20261021120000_daily_job.sql",
  "20261026161614_auth_attempts_hour.sql",
  "20261026163500_email_reservation.sql",
  "20261027120000_acting_tables.sql",
]);

// A schema-qualified name or the schema's role. `com.atproto.identity.x` and
// `https://river.example` don't count: a dot, slash or word character comes first.
const NAMES_RIVER = /(?<![\w./:-])(?:river\.[a-z_]+|river_app)\b/g;
const NAMES_IDENTITY = /(?<![\w./:-])(?:identity\.[a-z_]+|identity_app)\b/g;

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/** TypeScript without comments and without import lines (`./identity.js` is a module, not SQL). */
function stripTsNoise(ts: string): string {
  return ts
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|import\b|export\s.*\bfrom\b)/.test(line))
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, ext);
    return path.endsWith(ext) ? [path] : [];
  });
}

function matches(text: string, pattern: RegExp): string[] {
  return [...new Set(text.match(pattern) ?? [])];
}

describe("schema boundaries", () => {
  const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  it("the list of mixed migrations names only merged files that exist", () => {
    for (const name of MIXED_BEFORE_THE_SPLIT) expect(migrations, name).toContain(name);
  });

  it.each(migrations.filter((f) => !MIXED_BEFORE_THE_SPLIT.has(f)))(
    "%s touches one schema only",
    (file) => {
      const sql = stripSqlComments(readFileSync(join(MIGRATIONS, file), "utf8"));
      const river = matches(sql, NAMES_RIVER);
      const identity = matches(sql, NAMES_IDENTITY);
      expect(river.length === 0 || identity.length === 0, `river: ${river.join(", ")}; identity: ${identity.join(", ")}`).toBe(true);
    },
  );

  const riverCode = [...filesUnder(join(ROOT, "src", "river"), ".ts"), join(ROOT, "scripts", "revoke-links.ts")];
  const identityCode = [...filesUnder(join(ROOT, "src", "identity"), ".ts"), join(ROOT, "scripts", "recover-dids.ts")];

  it("River code never names the identity schema or role", () => {
    const found = riverCode.flatMap((path) =>
      matches(stripTsNoise(readFileSync(path, "utf8")), NAMES_IDENTITY).map((m) => `${relative(ROOT, path)}: ${m}`),
    );
    expect(found).toEqual([]);
  });

  it("identity code never names the river schema or role", () => {
    const found = identityCode.flatMap((path) =>
      matches(stripTsNoise(readFileSync(path, "utf8")), NAMES_RIVER).map((m) => `${relative(ROOT, path)}: ${m}`),
    );
    expect(found).toEqual([]);
  });

  it("the patterns catch what they are for", () => {
    expect(matches("DELETE FROM identity.auth_requests", NAMES_IDENTITY)).toEqual(["identity.auth_requests"]);
    expect(matches("GRANT USAGE ON SCHEMA x TO identity_app", NAMES_IDENTITY)).toEqual(["identity_app"]);
    expect(matches("SELECT river.daily_job()", NAMES_RIVER)).toEqual(["river.daily_job"]);
    expect(matches('xrpc("com.atproto.identity.resolveHandle")', NAMES_IDENTITY)).toEqual([]);
    expect(matches('"https://river.mosaic.social"', NAMES_RIVER)).toEqual([]);
    expect(matches(stripSqlComments("SELECT 1; -- identity.people"), NAMES_IDENTITY)).toEqual([]);
  });
});
