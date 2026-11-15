# Runbook: moving the identity schema to its own Supabase project

Part 5 of preparing Mosaic ID to leave this database. For Adam: these steps need the Supabase and
Vercel dashboards and the `postgres` password, which threads never hold. Names only; values never
go in git or in a chat.

**Today**: the River and Mosaic ID share the Supabase project river-dev. Mosaic ID's Vercel
project (`mosaic-id`) connects as `identity_app` and reads and writes the `identity` schema only.
**After**: Mosaic ID has its own project (called `mosaic-id-db` here). The River doesn't change at
all: it never connects to the identity schema, and it reaches Mosaic ID only through its public
origin (`IDENTITY_ORIGIN`, `TRUSTED_DID_HOSTS`), which stays the same.

The dump and restore commands below were rehearsed on a local stack (2026-10-27). That covered
restoring the schema into a fresh database with RLS on and forced on all 7 tables, all 7
policies, `identity_app`'s grants and the postgres-owned SECURITY DEFINER lookups. As
`identity_app` the copy showed 0 people (RLS) and the lookups answered.

## 0. Before you start

- [ ] **Part 1 has merged (#81)**: no River SQL touches the identity schema, and Mosaic ID's upkeep
      is its own job, `identity-daily`. Without it, `river.daily_job` would keep writing to a schema
      that has moved.
- [ ] **Part 2's history is in place** (the plan in `docs/identity-migrations-plan.md`, steps 1
      and 2): `identity.schema_migrations` exists on river-dev. The dump then carries the history,
      and the new project needs no Supabase CLI history for identity.
- [ ] Nobody is mid-change: no open PR adds an identity migration.
- [ ] Tools on your machine: `psql`, plus `pg_dump` and `pg_restore` **of the same major version
      as the server or newer**. Check with `SHOW server_version;` (the local stack is 17). An older
      `pg_dump` refuses ("server version mismatch"). If yours is older, run them from
      `docker run --rm -it -v "$PWD:/work" -w /work postgres:17 …`.
- [ ] A place for the dump: an encrypted disk on your machine, outside any git checkout. The dump
      holds email addresses, DID logs, sealed private keys (sealed with `IDENTITY_MASTER_KEY`,
      which isn't in the database) and token hashes. Never upload it, attach it or commit it.

Connection strings (from each project's Dashboard > Connect). Use the **session pooler**
(port 5432) as `postgres` for dump, restore and SQL, because the direct host is IPv6-only. Use the
**transaction pooler** (port 6543) as `identity_app` for the app. Keep them in shell variables for
the session, never in files:

```bash
read -rs OLD_DB   # river-dev session pooler URI as postgres, …?sslmode=verify-full
read -rs NEW_DB   # mosaic-id-db session pooler URI as postgres, …?sslmode=verify-full
export PGSSLROOTCERT=…   # each project's CA file; see step 1
```

## 1. Prepare the new project (any day before)

1. Create the Supabase project `mosaic-id-db`: same organization, **same region as river-dev** (and
   as the Vercel functions), a generated database password kept in your password manager. A free
   project pauses after about a week idle, the same as river-dev (step 6 moves the keep-alive).
2. Settings > Database: turn on **Enforce SSL**. Download the **CA certificate** (SSL
   Configuration). It is that project's; don't reuse river-dev's.
3. Settings > API > **Exposed schemas**: leave `identity` out (nothing from it goes through the Data
   API, as now).
4. Database > Extensions: enable **pg_cron**.
5. In the SQL editor, create the app role, exactly as `20261020213532_roles_and_schemas.sql` does,
   then give it a **new** password (don't reuse river-dev's):

   ```sql
   CREATE ROLE identity_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
   ALTER ROLE identity_app LOGIN PASSWORD '…';   -- generated, kept in your password manager
   ```

   The role has to exist before the restore, so the dump's grants to it apply.
6. **Rehearse**: run steps 3 and 4 below against the new project now, without step 2 (nothing on
   river-dev changes). Check step 4's results, then empty it again:
   `DROP SCHEMA identity CASCADE;` and `SELECT cron.unschedule('identity-daily');` in
   `mosaic-id-db`. Delete the rehearsal dump. The real run is then a repeat of something that
   already worked.

## 2. Start the outage: stop Mosaic ID writing to river-dev (T+0)

What breaks while this lasts: signing in to the River, signing up, recovery, changing an address,
and resolving DIDs (`/u/{code}/did.jsonl`), which also blocks River sign-in and space actions.
What keeps working: the River for visitors, and members already signed in (River sessions live
in the River's own schema). Aim for **under 15 minutes**. Pick a quiet hour, away from 04:17 to
04:30 UTC, when the daily jobs run.

```sql
-- On river-dev (psql "$OLD_DB"):
ALTER ROLE identity_app NOLOGIN;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'identity_app';
SELECT cron.unschedule('identity-daily');
SELECT count(*) FROM pg_stat_activity WHERE usename = 'identity_app';   -- expect 0
```

Mosaic ID now answers 500 on anything that needs the database, and nothing can change the
identity schema while you copy it.

## 3. Dump and restore (T+2)

```bash
pg_dump -Fc --schema=identity --no-owner -f identity.dump "$OLD_DB"
pg_restore --no-owner --exit-on-error --single-transaction -d "$NEW_DB" identity.dump
```

- `--schema=identity` takes the schema with its tables, data, indexes, constraints, row-level
  security (ENABLE and FORCE), policies, functions, `identity.schema_migrations` and the grants to
  `identity_app`. It doesn't take the role (step 1.5) or the pg_cron job (step 4).
- `--no-owner`: objects are owned by whoever restores, which must be `postgres`. The SECURITY
  DEFINER lookups rely on that owner to see past row-level security.
- `--single-transaction --exit-on-error`: either everything restores or nothing does.

## 4. Finish the new project and check it (T+5)

```sql
-- On mosaic-id-db (psql "$NEW_DB"):
SELECT cron.schedule('identity-daily', '23 4 * * *', 'SELECT identity.daily_job()');

-- Belt and braces: nobody but identity_app (and the owner) reaches the schema.
REVOKE ALL ON SCHEMA identity FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA identity FROM PUBLIC, anon, authenticated, service_role;
```

Then run these checks on **both** databases and compare. The row counts must be equal:

```sql
SELECT 'people' t, count(*) FROM identity.people UNION ALL
SELECT 'passkeys', count(*) FROM identity.passkeys UNION ALL
SELECT 'did_log', count(*) FROM identity.did_log UNION ALL
SELECT 'keys', count(*) FROM identity.keys UNION ALL
SELECT 'auth_requests', count(*) FROM identity.auth_requests UNION ALL
SELECT 'audit_log', count(*) FROM identity.audit_log UNION ALL
SELECT 'recovery_tokens', count(*) FROM identity.recovery_tokens UNION ALL
SELECT 'schema_migrations', count(*) FROM identity.schema_migrations;
```

On the new project only:

```sql
-- Every table has RLS enabled and forced: expect no rows.
SELECT relname FROM pg_class
 WHERE relnamespace = 'identity'::regnamespace AND relkind = 'r'
   AND NOT (relrowsecurity AND relforcerowsecurity);
-- Policies: the same number as on river-dev.
SELECT count(*) FROM pg_policies WHERE schemaname = 'identity';
-- The role: expect t | f | f.
SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'identity_app';
-- The API roles reach nothing: expect f | f | f.
SELECT has_schema_privilege('anon', 'identity', 'USAGE'),
       has_schema_privilege('authenticated', 'identity', 'USAGE'),
       has_schema_privilege('service_role', 'identity', 'USAGE');
-- The job: expect one row, run as postgres.
SELECT jobname, schedule, command, username FROM cron.job WHERE jobname = 'identity-daily';
```

Then, as the app role through the transaction pooler (the URI you'll give Vercel):
`psql "<identity_app URI>" -c "SELECT count(*) FROM identity.people"` should answer `0` (row-level
security with no settings), not an error.

## 5. Point Mosaic ID at the new project (T+8)

Vercel, project `mosaic-id` > Settings > Environment Variables, **Production** (and Preview, if
Preview has them):

| Variable | New value |
| --- | --- |
| `DATABASE_URL` | the new transaction pooler URI as `identity_app.[new-ref]`, port 6543, `?sslmode=verify-full` |
| `DATABASE_CA_CERT` | the new project's PEM (step 1.2) |

Nothing else changes: `IDENTITY_MASTER_KEY`, `SESSION_SECRET`, `RP_ID` and the origins stay as
they are. **Don't touch the River's project.** Environment changes apply only to new
deployments: Deployments > the current production deployment > **Redeploy**.

## 6. End the outage: smoke test (T+10)

- [ ] `https://id.mosaic.social/health` → `{"ok":true,"app":"identity"}`
- [ ] `https://id.mosaic.social/health/db` → `{"ok":true,"app":"identity","database":true}` (part 4)
- [ ] A known DID log, `https://id.mosaic.social/u/{code}/did.jsonl`, → 200 with its lines
- [ ] Sign in to the River with an existing passkey (proves note signing with the restored keys)
- [ ] Sign up a test Mosaic ID (passkey, then the confirm email)
- [ ] The Vercel function logs for `mosaic-id` show no database errors

The outage is over once sign-in works. Then:

- The keep-alive: the River's `keep-alive` workflow requests Mosaic ID's `/health/db`, which now
  reaches the new project, so both projects stay awake. When Mosaic ID has its own repository,
  move that request into its own workflow.
- Mosaic ID's migration deploys (part 2, step 3) point at the new project. In its repository's
  `supabase-…` environment, replace the database URL secret with the new session pooler URI. The
  runner finds every file already recorded and applies nothing.

## 7. Rollback

**Before anyone has written to the new project** (in practice, until the first sign-up or sign-in
after step 5): undo steps 5 and 2.

1. In Vercel, put `DATABASE_URL` and `DATABASE_CA_CERT` back to the river-dev values (Vercel keeps
   no history of variable values, so write the old ones in your password manager before step 5),
   then redeploy.
2. On river-dev: `ALTER ROLE identity_app LOGIN;` and
   `SELECT cron.schedule('identity-daily', '23 4 * * *', 'SELECT identity.daily_job()');`
3. On mosaic-id-db: `ALTER ROLE identity_app NOLOGIN;` so nothing writes there by mistake.

**After writes on the new project**: river-dev's copy is now stale, and switching back would lose
those sign-ups and passkeys. Run the move in reverse instead. Stop writes on mosaic-id-db (step 2
there). On river-dev, keep the old copy: `ALTER SCHEMA identity RENAME TO identity_before_move;`.
Dump mosaic-id-db and restore into river-dev (step 3 the other way). Re-check (step 4), and point
Vercel back (step 5). Drop `identity_before_move` only after checking.

## 8. Clean up (after a week of normal running)

- [ ] On river-dev, once you're sure you won't roll back: `DROP SCHEMA identity CASCADE;`, then
      `DROP OWNED BY identity_app; DROP ROLE identity_app;`. Leave Supabase's migration history on
      river-dev as it is (it records what happened). The River's history still holds the old
      identity migrations, but `db push` never re-runs a recorded version.
- [ ] Shred the dump: `shred -u identity.dump`, or delete it from the encrypted disk.
- [ ] `docs/deploy.md`: the `mosaic-id` project's `DATABASE_URL` row names the new project.
- [ ] The River (a separate, later decision; part 2, step 4): remove the identity side from its
      tests and local stack, and decide whether to squash its history so fresh stacks stop creating
      an identity schema.
