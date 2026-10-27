// The daily job (spec 3.1 Retention, 4.5): river.daily_job(at) with the clock moved ahead. It runs
// as postgres under pg_cron, so this test calls it as postgres, inside a transaction that is
// rolled back, so the shared local database (and the dev server's data) is left as it was.
// river_app can't execute it (catalog.test.ts).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL, SEED_INSTANCE, requireDatabase } from "./roles.js";

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });

beforeAll(async () => {
  await requireDatabase(admin, "postgres (daily job only)");
});

afterAll(async () => {
  await admin.end();
});

/** Runs `fn` in a transaction that is always rolled back. */
async function rolledBack(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

describe("river.daily_job", () => {
  it("is scheduled once, at 04:17 UTC, as SQL with no network", async () => {
    const { rows } = await admin.query("SELECT jobname, schedule, command, username FROM cron.job WHERE jobname = 'river-daily'");
    expect(rows).toEqual([
      { jobname: "river-daily", schedule: "17 4 * * *", command: "SELECT river.daily_job()", username: "postgres" },
    ]);
  });

  it("120 days on: keeps followed final results and samples, deletes the rest (check 18's retention part)", async () => {
    await rolledBack(async (db) => {
      const at = (await db.query<{ at: Date }>("SELECT now() + interval '120 days' AS at")).rows[0]!.at;
      const space = (
        await db.query<{ id: string }>(
          `INSERT INTO river.spaces (adapter, canonical_url, name) VALUES ('civic_hub', $1, 'Retention test') RETURNING id`,
          [`https://retention-test.invalid/${randomUUID()}`],
        )
      ).rows[0]!.id;
      const followedKey = "https://retention-test.invalid/process/followed";
      const otherKey = "https://retention-test.invalid/process/other";
      const streams = (
        await db.query<{ id: string; key: string }>(
          `INSERT INTO river.streams (space_id, key, status, ended_at) VALUES ($1, $2, 'ended', now()), ($1, $3, 'ended', now())
           RETURNING id, key`,
          [space, followedKey, otherKey],
        )
      ).rows;
      const followedStream = streams.find((s) => s.key === followedKey)!.id;
      const insertItem = (sourceId: string, key: string | null, final: boolean, published: string) =>
        db.query(
          `INSERT INTO river.items (space_id, source_id, kind, published_at, stream_key, is_final_result)
           VALUES ($1, $2, 'civic', ${published}, $3, $4)`,
          [space, sourceId, key, final],
        );
      await insertItem("followed-result", followedKey, true, "now()");
      await insertItem("followed-end", followedKey, false, "now()");
      await insertItem("other-result", otherKey, true, "now()");
      await insertItem("plain-post", null, false, "now()");
      await insertItem("recent-post", null, false, "now() + interval '100 days'");

      // A member followed just that stream; it ended now, so 120 days on the follow itself is
      // cleared by the same run, after its stream has been marked as followed.
      const account = (
        await db.query<{ id: string }>("INSERT INTO river.accounts (instance_id) VALUES ($1) RETURNING id", [SEED_INSTANCE])
      ).rows[0]!.id;
      await db.query(
        `INSERT INTO river.follows (instance_id, account_id, space_id, stream_id, ends_with_stream)
         VALUES ($1, $2, $3, $4, true)`,
        [SEED_INSTANCE, account, space, followedStream],
      );
      // Seeded samples carry raw.sample.age; the isolation tests' own 'sample' rows don't.
      const sampleCounts = async () =>
        (
          await db.query<{ all: number; seeded: number }>(
            `SELECT count(*)::int AS all, (count(*) FILTER (WHERE i.raw -> 'sample' ? 'age'))::int AS seeded
               FROM river.items i JOIN river.spaces s ON s.id = i.space_id WHERE s.adapter = 'sample'`,
          )
        ).rows[0]!;
      const samplesBefore = await sampleCounts();

      // identity.auth_requests (M7): every request that expired more than a day before `at` goes; a
      // request still open at `at` stays.
      const keptRequest = (
        await db.query<{ id: string }>(
          `INSERT INTO identity.auth_requests (id, purpose, client_id, redirect_uri, state, nonce, webauthn_challenge, created_at, expires_at)
           VALUES ($1, 'authorize', 'c', 'r', 's', 'n', $2, $3, $3::timestamptz + interval '10 minutes') RETURNING id`,
          [randomUUID(), "a".repeat(43), at],
        )
      ).rows[0]!.id;
      await db.query(
        `INSERT INTO identity.auth_requests (id, purpose, client_id, redirect_uri, state, nonce, webauthn_challenge, expires_at)
         VALUES ($1, 'authorize', 'c', 'r', 's', 'n', $2, now() + interval '10 minutes')`,
        [randomUUID(), "b".repeat(43)],
      );
      const stale = (
        await db.query<{ n: number }>("SELECT count(*)::int AS n FROM identity.auth_requests WHERE expires_at < $1::timestamptz - interval '1 day'", [at])
      ).rows[0]!.n;
      expect(stale).toBeGreaterThanOrEqual(1);

      // river.auth_attempts (M8; an hour since the security review of 3a86e8f): every attempt made
      // more than an hour before `at` goes, two hours old included; one made at `at` stays.
      const keptState = randomUUID().replaceAll("-", "") + "k";
      await db.query(
        `INSERT INTO river.auth_attempts (state, instance_id, nonce, created_at)
         VALUES ($1, $2, $3, $4), ($5, $2, $3, now()), ($6, $2, $3, $4::timestamptz - interval '2 hours')`,
        [keptState, SEED_INSTANCE, "n".repeat(43), at, randomUUID().replaceAll("-", "") + "o", randomUUID().replaceAll("-", "") + "h"],
      );
      const staleAttempts = (
        await db.query<{ n: number }>("SELECT count(*)::int AS n FROM river.auth_attempts WHERE created_at < $1::timestamptz - interval '1 hour'", [at])
      ).rows[0]!.n;
      expect(staleAttempts).toBeGreaterThanOrEqual(2);

      const summary = (await db.query<{ r: Record<string, number> }>("SELECT river.daily_job($1) AS r", [at])).rows[0]!.r;
      expect(summary).toMatchObject({ ended_follows: 1, deleted_auth_attempts: staleAttempts, deleted_auth_requests: stale });
      const attemptsLeft = (await db.query<{ state: string }>("SELECT state FROM river.auth_attempts")).rows.map((r) => r.state);
      expect(attemptsLeft).toEqual([keptState]);
      const requestsLeft = (await db.query<{ id: string }>("SELECT id FROM identity.auth_requests")).rows.map((r) => r.id);
      expect(requestsLeft).toEqual([keptRequest]);
      expect(summary.deleted_follows).toBeGreaterThanOrEqual(1);
      expect(summary.restamped_samples).toBe(samplesBefore.seeded);
      expect(samplesBefore.seeded).toBeGreaterThanOrEqual(5);

      const left = (
        await db.query<{ source_id: string }>("SELECT source_id FROM river.items WHERE space_id = $1 ORDER BY 1", [space])
      ).rows.map((r) => r.source_id);
      expect(left).toEqual(["followed-result", "recent-post"]);
      expect((await db.query("SELECT 1 FROM river.follows WHERE account_id = $1", [account])).rowCount).toBe(0);

      // Samples stay, re-stamped relative to the job's clock.
      expect(await sampleCounts()).toEqual(samplesBefore);
      const samples = (
        await db.query<{ newest: Date }>(
          `SELECT max(i.published_at) AS newest FROM river.items i WHERE i.raw -> 'sample' ? 'age'`,
        )
      ).rows[0]!;
      expect(at.getTime() - samples.newest.getTime()).toBeLessThan(24 * 60 * 60 * 1000);
      const event = (
        await db.query<{ start: string }>(
          "SELECT raw ->> 'startTime' AS start FROM river.items WHERE source_id = 'urn:mosaic:sample:elm-street-neighbors:1'",
        )
      ).rows[0]!;
      expect(Date.parse(event.start)).toBeGreaterThan(at.getTime());

      // The next day the follow is gone, and the final result is still kept.
      await db.query("SELECT river.daily_job($1::timestamptz + interval '1 day')", [at]);
      const still = (await db.query("SELECT 1 FROM river.items WHERE space_id = $1 AND source_id = 'followed-result'", [space])).rowCount;
      expect(still).toBe(1);
    });
  });

  it("purges acting rows: stale previews, day-old attempts, idle credentials, year-old actions (ADR-010)", async () => {
    await rolledBack(async (db) => {
      const at = (await db.query<{ at: Date }>("SELECT now() AS at")).rows[0]!.at;
      const account = (
        await db.query<{ id: string }>("INSERT INTO river.accounts (instance_id) VALUES ($1) RETURNING id", [SEED_INSTANCE])
      ).rows[0]!.id;
      const sealed = "'\\x" + "ab".repeat(40) + "'::bytea, '\\x" + "cd".repeat(60) + "'::bytea, 1";
      const link = (used: string, actor: string) =>
        db
          .query<{ id: string }>(
            `INSERT INTO river.linked_accounts (instance_id, account_id, kind, server_host, actor_uri,
                                                token_ciphertext, token_dek, token_key_version, created_at, last_used_at)
             VALUES ($1, $2, 'fediverse', 'example.social', $3, ${sealed}, $4::timestamptz - interval '400 days', $4::timestamptz - ${used})
             RETURNING id`,
            [SEED_INSTANCE, account, actor, at],
          )
          .then((r) => r.rows[0]!.id);
      const idle = await link("interval '181 days'", "https://example.social/users/idle");
      const recent = await link("interval '179 days'", "https://example.social/users/recent");
      const ended = (
        await db.query<{ id: string }>(
          `INSERT INTO river.linked_accounts (instance_id, account_id, kind, server_host, actor_uri, status, revoked_at)
           VALUES ($1, $2, 'fediverse', 'example.social', 'https://example.social/users/old', 'unlinked', $3::timestamptz - interval '366 days')
           RETURNING id`,
          [SEED_INSTANCE, account, at],
        )
      ).rows[0]!.id;

      const action = (status: string, age: string, verb = "post", kind = "text") =>
        db
          .query<{ id: string }>(
            `INSERT INTO river.member_actions (instance_id, account_id, channel, linked_account_id, target_host, verb, limit_kind,
                                               status, session_epoch, created_at)
             VALUES ($1, $2, 'fediverse', $3, 'example.social', $4, $5, $6, 1, $7::timestamptz - ${age}) RETURNING id`,
            [SEED_INSTANCE, account, recent, verb, kind, status, at],
          )
          .then((r) => r.rows[0]!.id);
      const stalePreview = await action("previewed", "interval '16 minutes'");
      const freshPreview = await action("previewed", "interval '14 minutes'");
      const sentOld = await action("sent", "interval '366 days'");
      const sentRecent = await action("sent", "interval '364 days'");
      const undo = await action("sent", "interval '1 day'", "delete", "delete");
      await db.query("UPDATE river.member_actions SET undoes_id = $1 WHERE id = $2", [sentOld, undo]);

      const attempt = (age: string) =>
        db
          .query<{ id: string }>(
            `INSERT INTO river.acting_attempts (instance_id, account_id, state, purpose, server_host, created_at)
             VALUES ($1, $2, $3, 'fediverse_link', 'example.social', $4::timestamptz - ${age}) RETURNING id`,
            [SEED_INSTANCE, account, randomUUID().replaceAll("-", ""), at],
          )
          .then((r) => r.rows[0]!.id);
      const staleAttempt = await attempt("interval '25 hours'");
      const freshAttempt = await attempt("interval '23 hours'");

      const summary = (await db.query<{ r: Record<string, number> }>("SELECT river.daily_job($1) AS r", [at])).rows[0]!.r;
      expect(summary.deleted_previews).toBeGreaterThanOrEqual(1);
      expect(summary.deleted_acting_attempts).toBeGreaterThanOrEqual(1);
      expect(summary.lapsed_links).toBeGreaterThanOrEqual(1);
      expect(summary.deleted_member_actions).toBeGreaterThanOrEqual(1);
      expect(summary.deleted_linked_accounts).toBeGreaterThanOrEqual(1);

      const actions = (
        await db.query<{ id: string; undoes_id: string | null }>("SELECT id, undoes_id FROM river.member_actions WHERE account_id = $1", [account])
      ).rows;
      expect(actions.map((a) => a.id).sort()).toEqual([freshPreview, sentRecent, undo].sort());
      // The undo outlives the year-old act it undid, pointing at nothing.
      expect(actions.find((a) => a.id === undo)!.undoes_id).toBeNull();
      expect(actions.map((a) => a.id)).not.toContain(stalePreview);

      const attempts = (await db.query<{ id: string }>("SELECT id FROM river.acting_attempts WHERE account_id = $1", [account])).rows;
      expect(attempts.map((a) => a.id)).toEqual([freshAttempt]);
      expect(attempts.map((a) => a.id)).not.toContain(staleAttempt);

      const links = (
        await db.query<{ id: string; status: string; has_token: boolean; revoked_at: Date | null }>(
          `SELECT id, status, token_ciphertext IS NOT NULL AS has_token, revoked_at
             FROM river.linked_accounts WHERE account_id = $1 ORDER BY actor_uri`,
          [account],
        )
      ).rows;
      expect(links).toEqual([
        { id: idle, status: "lapsed", has_token: false, revoked_at: at },
        { id: recent, status: "active", has_token: true, revoked_at: null },
      ]);
      expect(links.map((l) => l.id)).not.toContain(ended);
    });
  });
});
