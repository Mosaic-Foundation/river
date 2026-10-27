# Plan: a migration history of its own for Mosaic ID

Part 2 of preparing Mosaic ID to leave this repository and, later, this database. **This is a
plan for Adam to review. Nothing here changes any migration history yet.** The steps that do
are marked with their own PR, and each waits for approval of this plan.

## The problem

Today one folder, `supabase/migrations/`, and one history table, Supabase's
`supabase_migrations.schema_migrations`, describe both schemas. A second repository can't share
that table. The Supabase CLI treats any version in the table that isn't in its own folder as an
error ("remote migration versions not found in local migrations directory") until someone runs
`migration repair`. I don't know of a CLI option for a second history table in the same database.
If the River and Mosaic ID each ran `supabase db push` against river-dev, each would see the
other's versions and refuse, or be repaired into forgetting them.

So Mosaic ID needs a history the CLI doesn't own: its own folder, applied by a small runner that
records each file in `identity.schema_migrations`. The history then lives inside the identity
schema and moves with it in a dump (part 5).

## What river-dev holds today

Every file in `supabase/migrations/` is applied there and recorded in Supabase's table. These
touch the identity schema:

| Migration | Identity part | River part |
| --- | --- | --- |
| `20261020213532_roles_and_schemas` | schema `identity`, role `identity_app`, USAGE | schema `river`, role `river_app`, settings readers |
| `20261021120000_daily_job` | purge in `river.daily_job` (superseded) | the daily job |
| `20261021140000_identity_tables` | **all of it**: 7 tables, policies, lookups | none |
| `20261026161614_auth_attempts_hour` | purge in `river.daily_job` (superseded) | the job |
| `20261026163500_email_reservation` | `people.email` nullable, partial unique index, `email_in_use`, `remove_other_passkey`, audit actions | address release in `river.daily_job` (superseded) |
| `20261026214500_account_requests` | **all of it**: `auth_requests` purpose check | none |
| `20261027120000_acting_tables` | purge and release in `river.daily_job` (superseded) | acting tables |
| `20261027170000_identity_daily_job` (part 1, #81) | **all of it**: `identity.daily_job`, cron `identity-daily` | none |

These files stay exactly where they are, in the River's history. Nothing is re-run and nothing
is deleted from either history table.

## The plan

### Step 1 (PR "identity history", needs-adam): a folder, a baseline and a runner, run locally only

- **Folder**: `supabase/identity/migrations/`. It is outside `supabase/migrations/`, so the CLI
  never reads it. Files are named `YYYYMMDDHHMMSS_name.sql`, as now.
- **Baseline**: `supabase/identity/migrations/20261028000000_baseline.sql` creates the identity
  schema as river-dev has it after part 1: the role `identity_app`, made idempotently with the
  same safety checks as `roles_and_schemas`, plus the schema, functions, the seven tables,
  constraints, indexes, row-level security, policies, grants, `identity.daily_job` and the
  `identity-daily` job. I'd write it from `pg_dump --schema-only --schema=identity` of a local
  stack and tidy it by hand. A test proves it matches (below).
- **The runner**: `npm run identity-migrate`, made of `scripts/identity-migrate.ts` plus
  `src/db/migrate.ts`, since `pg` is imported only under `src/db/`. It works like this:
  1. Connects with `IDENTITY_MIGRATIONS_DATABASE_URL` (read in `src/config/env.ts`; a role that can
     run DDL: `postgres` through the session pooler on 5432, never `identity_app`).
  2. Takes `pg_advisory_lock` on a fixed key, so two runs can't interleave.
  3. Runs `CREATE SCHEMA IF NOT EXISTS identity` and creates `identity.schema_migrations` if it
     isn't there. Its columns: `version text PRIMARY KEY`, `name text`, `checksum text` (SHA-256 of
     the file), `applied_at timestamptz`, `mode text CHECK (mode IN ('applied', 'adopted'))`. The
     table has ENABLE and FORCE ROW LEVEL SECURITY, no policies, and no grants to `identity_app`.
  4. For each file in version order:
     - Already recorded with the same checksum: skip.
     - Recorded with a different checksum: stop and name the file. A merged migration was edited.
     - The baseline, not recorded, on a database that already has the identity schema
       (river-dev, or any local stack built from the River's history): **adopt** it. That means
       recording it with `mode = 'adopted'` without running it, but only after checking the
       schema is the one the baseline describes: `identity.people` and `identity.daily_job` exist,
       and Supabase's history table holds every version in the table above. If those checks
       fail, it stops and changes nothing.
     - Otherwise: run the file and insert its row **in one transaction**, so a failed file
       leaves no record and no half-applied change.
  5. `--dry-run` prints what it would do and touches nothing.
- **Local and CI**: after `npx supabase start`, CI runs the runner as the local `postgres`. On a
  stack built from the River's history it adopts the baseline. An API db test then checks:
  - **Adoption is right**: `pg_dump --schema-only --schema=identity` of the local stack equals a dump
    of the baseline applied alone to an empty scratch database (`CREATE DATABASE identity_fresh`
    on the same stack), apart from the runner's own table. So the baseline describes what river-dev
    has, and a fresh database built from Mosaic ID's history alone is the same.
  - The runner never runs a file twice, refuses an edited file, and leaves no record for a file
    that fails.
- **The boundary test from part 1 grows two rules**: no new file in `supabase/migrations/` names
  the identity schema, and nothing in `supabase/identity/migrations/` names `river`.

Step 1 changes no history on river-dev. Nothing runs there yet.

### Step 2 (PR "apply identity history on river-dev", needs-adam: `.github/`)

`deploy-migrations.yml` gets a step after `supabase db push`: `npm run identity-migrate` against
the same `SUPABASE_DB_URL`, with `--dry-run` printed first. The workflow's `paths` also take
`supabase/identity/migrations/**`. On its first run on river-dev it **adopts** the baseline:
one row inserted in a new table, and no change to any existing object. Adam can run the dry run
by hand first (workflow_dispatch) and read its output.

From then on, every identity schema change is a new file in `supabase/identity/migrations/`.

### Step 3 (when Mosaic ID's repository exists)

- The new repository starts with a copy of `supabase/identity/migrations/` and the runner (with
  the files part 3 lists), and its own deploy workflow running the runner against river-dev. It
  finds every file already recorded in `identity.schema_migrations` and applies nothing.
- In the same changeover, the River deletes `supabase/identity/` and its workflow step. Only one
  repository applies identity migrations at a time. If both ran by mistake, the lock and the
  checksums mean a file is never applied twice and a diverged file is refused.

### Step 4 (the move to its own Supabase project: part 5's runbook)

The dump of the `identity` schema includes `identity.schema_migrations`, so the history arrives
with the data. The new project needs no Supabase CLI history for identity at all. After the move
the River can drop the identity schema from river-dev (runbook). It can also, as a separate River
decision, squash its own history so fresh local stacks stop creating an identity schema they no
longer use. That squash is the only step that would rewrite the River's recorded history, and it
needs its own approval.

## Why not the alternatives

- **Supabase CLI in both repositories against one database**: one history table, so each sees
  the other's versions as unknown and refuses, or `migration repair` makes it forget them.
- **Move the identity files out of `supabase/migrations/`**: the River's CLI then refuses to push,
  because the recorded versions are missing locally, until it is repaired. That is a history change
  for nothing, since adoption gets the same result without one.
- **Replay the old identity migrations in the new history**: they aren't separable. Four of them
  also redefine `river.daily_job`, and replaying them on river-dev would re-run DDL that is
  already applied.
- **An off-the-shelf runner** (graphile-migrate, node-pg-migrate, sqitch): each would work, but
  each brings its own conventions and dependencies for about 150 lines of code, and adopting an
  existing schema is the custom part anyway. I'm happy to switch if Adam prefers one.

## Open points for Adam

1. **pg_cron in a scratch database**: on Supabase, pg_cron lives only in the `postgres` database
   (`cron.database_name`). For the fresh-database test, the baseline schedules `identity-daily`
   only when it runs in that database, and the test compares jobs separately. Fine?
2. **Which role the runner uses on river-dev**: the existing `SUPABASE_DB_URL` (postgres through
   the session pooler), or a dedicated migration role for identity, which would make the later
   move cleaner but is one more credential.
3. **The baseline's version** `20261028000000`. Any version later than part 1 works.
4. **Order**: part 1 (#81) merges before step 1, so the baseline can include `identity-daily`.
