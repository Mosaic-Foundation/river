# Handoff

Newest entry first. Every slice adds one entry at the top, in this shape:

```
## <Title>: <one-line summary> — YYYY-MM-DD

- Branch / PR: claude/<task> → #<n> (merged | needs-adam)
- Migrations: <files, or none>

**What it does.** Two or three sentences.

**Keys.** Env vars, flags or config it introduced (names only).

**Tests.** What was added; summary line from `npm run check` (and e2e if run).

### Follow-ups
- Anything left undone, with the reason.
```

<!-- entries below -->

## M1 Schemas and access: roles, river tables with forced RLS, seed instance, isolation proven — 2026-10-20

- Branch / PR: claude/vibrant-keller-6qnr0g → PR (needs-adam: roles, row-level security, `.github/`, `supabase/seed.sql`)
- Migrations: `20261020213532_roles_and_schemas.sql`, `20261020213534_river_tables.sql`,
  `20261020213536_seed_instance.sql`; `supabase/seed.sql` (local and CI only)

**What it does.** Creates the `river` and `identity` schemas and the `river_app` and
`identity_app` roles (NOLOGIN, no BYPASSRLS, idempotent, each with USAGE on its own schema only,
no passwords). Adds the river tables of spec 3.1 except `login_methods`/`auth_attempts` (M8),
each with ENABLE + FORCE RLS and river_app-only policies on `current_setting('app.instance_id', true)`
and `current_setting('app.account_id', true)`, plus the seed instance for river.mosaic.social.
`seed.sql` makes both roles LOGIN with `local-only` and adds a second test instance.
`forInstance()`/`forAccount()` now give `insert()`, which stamps ids and refuses another
instance's or account's payload; ids must be uuids. `pool.ts` owns TLS: any non-loopback host
gets verify-full whatever `sslmode` says, optional `DATABASE_CA_CERT`. CI connects as each role
after `supabase start` and runs the database tests.

**Keys.** `DATABASE_CA_CERT` (optional, both apps). Test-only: `TEST_RIVER_DATABASE_URL`,
`TEST_IDENTITY_DATABASE_URL` (read by tests only; local defaults). Seed instance id
`00000000-0000-4000-8000-000000000001`.

**Tests.** `tests/api/db/catalog` and `tests/api/db/isolation` (check 27) as river_app and
identity_app; unit `dbContext` and `dbPool` extended. `npm run check`: Test Files 6 passed (6),
Tests 48 passed (48), UI built. `npm run test:api`: Test Files 2 passed (2), Tests 19 passed (19).
`npm run test:e2e`: 5 passed. The local Supabase stack started this session (Kong came from
Docker Hub after the ECR and GHCR blob hosts failed DNS; Postgres was cached).

### Follow-ups
- **Adam, after merge (hand-off section 2, "database role passwords"):** `deploy-migrations`
  creates the roles NOLOGIN on the dev project. In its SQL editor run, each with its own generated
  password: `ALTER ROLE river_app LOGIN PASSWORD '…';` and
  `ALTER ROLE identity_app LOGIN PASSWORD '…';`. Then set `DATABASE_URL` in Vercel: project
  `river` → `postgresql://river_app.[project-ref]:[password]@[pooler host]:6543/postgres?sslmode=verify-full`;
  project `mosaic-id` → the same with `identity_app`. If the first query fails with "self-signed
  certificate in certificate chain", add `DATABASE_CA_CERT` (Dashboard > Database > SSL
  Configuration) to both projects. TLS against the hosted pooler is untested from here.
- M6: hostname resolution needs a no-settings wrapper that can read `instances` (DECISIONS, spec
  questions).
- M5: sample spaces and their circle memberships in a new migration; the pg_cron job (runs as
  postgres, which has BYPASSRLS, for retention).
- M7: identity tables and the setting forIdentity() sets.
- M8: `login_methods`, `auth_attempts`.

## M0 Scaffold: two apps from one codebase, pg layer, CI with both servers, themes — 2026-10-20

- Branch / PR: claude/mosaic-river-v1-m0-8dyv4n → PR (needs-adam: CI, Vercel config, database layer)
- Migrations: none (`supabase/config.toml` from `npx supabase init`; `seed.sql` arrives in M1)

**What it does.** `createApp("river" | "identity")` mounts only that side's routes; `/health`
returns `{ ok: true, app }` with no database. `src/river/`, `src/identity/` and `src/shared/` each
have an index and a placeholder route. `identity/` is the `mosaic-id` Vercel project (its own
`vercel.json` and `api/index.ts`, static `public/passkey.js` bundled from `src/identity/client/`).
supabase-js is gone: `src/db/pool.ts` (lazy, `max: 3`) and `src/db/context.ts` (forInstance,
forAccount, forIdentity: transaction plus `set_config` with bind parameters) are the only `pg`
users, and lint enforces it. CI writes `.env` and `.env.identity`, starts local Supabase (Postgres
only), the API and the identity host. UI has the Mosaic (default) and Civic themes with
self-hosted Fontsource fonts.

**Keys.** River: `APP`, `PORT`, `DATABASE_URL`, `SESSION_SECRET`, `RIVER_PUBLIC_ORIGIN`,
`IDENTITY_ORIGIN`, `TRUSTED_DID_HOSTS`, `INSTANCE_HOST_ALIASES`. Identity: `IDENTITY_MASTER_KEY`,
`RP_ID`, `IDENTITY_PUBLIC_ORIGIN`, `RIVER_CLIENT_ORIGINS`, `EMAIL_TRANSPORT`, `RESEND_API_KEY`,
`EMAIL_FROM`. Test-only (refused on Vercel): `FETCH_FIXTURES_DIR`, `TEST_ROUTES`. Scripts:
`dev:identity`, `build:identity-client`, `test:live`, `record-fixtures`.

**Tests.** Unit: health for both apps without `DATABASE_URL`, env rules, db context (fake pool),
pool, Vercel adapter, lint boundaries. E2E: both `/health`s, identity page and `passkey.js`,
themes and no off-origin requests. `npm run check`: Test Files 6 passed (6), Tests 35 passed (35),
UI built. `npm run test:e2e`: 5 passed.

### Follow-ups
- Adam created the identity Vercel project as `mosaic-id` (Root Directory `identity/`); confirm
  `/health` on both previews. If its first build shows CommonJS errors, add
  `identity/package.json` with `{"private": true, "type": "module"}` (hand-off 3.2).
- The session's local Supabase stack could not start: Docker Hub answered 429, public.ecr.aws
  "Data limit exceeded", ghcr.io blob downloads 403. No query runs in M0; CI's `supabase start` is
  the proof. The cloud setup script's image pre-pull didn't leave images cached, and dockerd was
  not running at session start (started by hand with `dockerd &`).
- M1: Supabase's pooler needs TLS; check how `sslmode` in `DATABASE_URL` behaves with pg 8's
  verify-full default before the first hosted query.
- CSP (Appendix B) isn't set yet; it belongs with the first pages that load scripts (M6, M7).
