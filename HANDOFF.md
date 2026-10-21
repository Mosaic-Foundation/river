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

## M3 Civic Hub adapter: resolve, paging, allowlist, templates, stream end; sanitizer and item model — 2026-10-21

- Branch / PR: claude/m3-civic-hub-adapter → PR (needs-adam: sanitizer allowlist). Branched from
  M2 (#6, needs-adam, unmerged); merge M2 first.
- Migrations: none

**What it does.** `src/shared/sanitize/` (Appendix B allowlist) and `src/shared/items/` (item
model, Adapter contract) are shared with M4. `src/river/adapters/civicHub/` resolves hubs from
`/.well-known/civic.json`, maps UI URLs to stream keys and validates them, fetches the first 90
days (5 pages) or refreshes from newest − 14 days (3 pages) with If-None-Match only for the same
URL, maps activities through a closed-by-default allowlist and `hubTemplates.ts`, keeps public
items only, and reports stream ends and final results. 36 recorded fixtures from Demosville,
Floyd and Longmont; recorder in `scripts/recorders/civicHub.ts`.

**Keys.** None. Dependencies: `sanitize-html` ^2.18.1, `@types/sanitize-html` (dev).

**Tests.** `sanitize` (6) and `tests/unit/civicHub/` (74): every allowlist row and the hidden
list, each template, mapping, check 18 adapter part (real Floyd End → Aggregation → Result; a
derived split across fetches), 22 (sanitized content), 25 (real 5-page first fetch, short page
with next, refresh window, If-None-Match only for the same URL, real 304s from all three hubs), and
resolve (13, 14, 16 through the adapter). `npm run check`: Test Files 12 passed (12), Tests 174
passed (174), UI built.

### Follow-ups
- M5 refresh: call `fetchNew(space, { guard, now, onPage })`; insert per page in `forInstance()`
  with `ON CONFLICT (space_id, source_id)`; on `notModified` only stamp `last_fetched_at`; upsert
  streams from `StreamUpdate`s, set follows' `ended_at` for `ends_with_stream`, and move
  `is_final_result` to `finalItemSourceId` only when it is at least as new. Withdrawn check (33)
  uses `probeStream().exists`. Show `streams.title` when an item has none.
- API/e2e replay of hub feeds needs the server clock at `CIVIC_HUB_FIXTURE_NOW`.
- No real `no_hub` recording: the session proxy reaches only the three seed hubs. A derived body
  is tested instead.
- M9: try the hub adapter before the fediverse adapter for URLs; fall back on `not_a_space`.

## M2 Fetch guard: every outbound request checked, pinned, capped; fixture replay — 2026-10-21

- Branch / PR: claude/m2-fetch-guard → PR (needs-adam: fetch guard, ADR-001 scope)
- Migrations: none

**What it does.** `src/shared/fetch/` ports the Civic Hub's ssrfGuard onto undici: https only,
every address checked (private, loopback, link-local, CGNAT, multicast, metadata, IPv4-in-IPv6
forms, localhost names), connections pinned to the checked address through the Agent's
`connect.lookup`, redirects by hand (3, each checked), 2 MB, 6 s, 2 per host, Retry-After honored,
the River's User-Agent. `FetchError` codes plus `followMessage()` give the F6 wording. Fixture
format and replay (FETCH_FIXTURES_DIR, MockAgent) are defined. Lint keeps undici, node:http(s)
and global fetch inside the folder.

**Keys.** None new (`FETCH_FIXTURES_DIR` existed). Dependency: `undici` ^7.30.1.

**Tests.** `fetchGuard` (37: the hub's address table, all of check 16 with zero requests sent, pinning
and rebinding, redirects, limits, Retry-After, replay) and `lintBoundaries` (+8). Mutation check:
removing the resolved-address check, the per-host limit or the redirect re-check each fails tests.
One manual request through the real pinned Agent to demosville.civic.social returned 200.

### Follow-ups
- M3/M4 adapters take a `FetchGuard` (default `getFetchGuard()`); recorders use `saveFixture` and
  `fixtureFromResponse`, and register in `scripts/record-fixtures.ts`.
- Constraint 3 note: DID resolution (M8) and Resend (M7) go through this guard too.

## deploy-migrations: db push through the session pooler — 2026-10-21

- Branch / PR: claude/vibrant-keller-6qnr0g → PR (needs-adam: `.github/`)
- Migrations: none

**What it does.** `deploy-migrations` failed on hosted Supabase with "IPv6 is not supported on
your current network": GitHub's runners have no IPv6 and `db push` used the IPv6-only direct
database host. Both db push steps now pass `--db-url "$SUPABASE_DB_URL"` (the session pooler
URI, port 5432, a `supabase-dev` secret Adam added); the preview keeps `--dry-run`. The link step
stays. README Notes record the two lessons (scoped token permissions for link, pooler URL for push).

**Keys.** `SUPABASE_DB_URL` (secret of the `supabase-dev` GitHub environment; never in threads).

**Tests.** Workflow YAML parsed; `npm run check` green. Running `supabase db push` is not possible
from the session (no hosted credentials, by design), so the first proof is the workflow run after
merge: M1's migrations should apply and the run should go green.

### Follow-ups
- Adam: after merge, re-run `deploy-migrations` (workflow_dispatch) if no migration path changes
  in this PR trigger it, then set the role passwords and DATABASE_URLs (M1 entry).
- The runbook itself isn't in this repo; copy the two README notes into its lessons section.

## M1 follow-up: Adam's rulings recorded — 2026-10-20

- Branch / PR: claude/vibrant-keller-6qnr0g → docs PR
- Migrations: none

**What it does.** Records in `DECISIONS.md` Adam's answers to M1's spec questions: `forHost()` is
approved (it reads `river.instances` only; M6 amends CLAUDE.md constraint 2 in a `needs-adam`
PR), and shared tables keep requiring `app.instance_id`. `DATABASE_CA_CERT` is now documented as
needed on hosted Supabase; Adam sets it on `river` and `mosaic-id` from the start. The identity
project stays `mosaic-id`.

**Keys.** None new.

**Tests.** No code changed. `npm run check` green.

### Follow-ups
- M6: add `forHost()` in `src/db/context.ts` and the CLAUDE.md constraint 2 amendment.

## M1 Schemas and access: roles, river tables with forced RLS, seed instance, isolation proven — 2026-10-20

- Branch / PR: claude/vibrant-keller-6qnr0g → #3 (needs-adam: roles, row-level security, `.github/`, `supabase/seed.sql`)
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
