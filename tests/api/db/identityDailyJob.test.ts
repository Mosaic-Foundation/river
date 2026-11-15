// Mosaic ID's own daily job, identity.daily_job(at) (migration 20261027170000): it purges
// auth_requests and releases unverified addresses, which river.daily_job did until Mosaic ID began
// preparing to leave this database. Like the River's, it runs as postgres under pg_cron, so this
// test calls it as postgres inside a transaction that is rolled back. The address release is
// tested end to end in emailReservation.test.ts.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL, IDENTITY_URL, refusal, requireDatabase, rolePool } from "./roles.js";

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const identity = rolePool(IDENTITY_URL);

beforeAll(async () => {
  await requireDatabase(admin, "postgres (daily job only)");
  await requireDatabase(identity, "identity_app");
});

afterAll(async () => {
  await admin.end();
  await identity.end();
});

describe("identity.daily_job", () => {
  it("is scheduled once, at 04:23 UTC, as SQL with no network", async () => {
    const { rows } = await admin.query("SELECT jobname, schedule, command, username FROM cron.job WHERE jobname = 'identity-daily'");
    expect(rows).toEqual([
      { jobname: "identity-daily", schedule: "23 4 * * *", command: "SELECT identity.daily_job()", username: "postgres" },
    ]);
  });

  it("identity_app can't execute it", async () => {
    const { rows } = await identity.query("SELECT has_function_privilege('identity.daily_job(timestamptz)', 'EXECUTE') AS can");
    expect(rows).toEqual([{ can: false }]);
    expect((await refusal(() => identity.query("SELECT identity.daily_job()"))).code).toBe("42501");
  });

  it("deletes auth_requests a day after they expired, and keeps one still open", async () => {
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      const at = (await client.query<{ at: Date }>("SELECT now() + interval '120 days' AS at")).rows[0]!.at;
      const insert = (challenge: string, expires: string, params: unknown[]) =>
        client
          .query<{ id: string }>(
            `INSERT INTO identity.auth_requests (id, purpose, client_id, redirect_uri, state, nonce, webauthn_challenge, created_at, expires_at)
             VALUES ($1, 'authorize', 'c', 'r', 's', 'n', $2, ${expires} - interval '10 minutes', ${expires}) RETURNING id`,
            [randomUUID(), challenge, ...params],
          )
          .then((r) => r.rows[0]!.id);
      const kept = await insert("a".repeat(43), "$3::timestamptz + interval '10 minutes'", [at]);
      const gone = await insert("b".repeat(43), "now() + interval '10 minutes'", []);
      // Expired 23 hours before `at`: not yet a day.
      const recent = await insert("c".repeat(43), "$3::timestamptz - interval '23 hours'", [at]);
      const stale = (
        await client.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM identity.auth_requests WHERE expires_at < $1::timestamptz - interval '1 day'",
          [at],
        )
      ).rows[0]!.n;

      const summary = (await client.query<{ r: Record<string, number> }>("SELECT identity.daily_job($1) AS r", [at])).rows[0]!.r;
      expect(Object.keys(summary).sort()).toEqual(["deleted_auth_requests", "released_addresses"]);
      expect(summary.deleted_auth_requests).toBe(stale);
      const left = (await client.query<{ id: string }>("SELECT id FROM identity.auth_requests")).rows.map((r) => r.id);
      expect(left.sort()).toEqual([kept, recent].sort());
      expect(left).not.toContain(gone);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
