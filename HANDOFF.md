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

## M5 Feed API and daily job: samples, refresh on open, filters, search, pg_cron — 2026-10-21

- Branch / PR: claude/m5-feed-api → PR (needs-adam: a column and a SECURITY DEFINER function on
  existing tables, `.github/`, CLAUDE.md constraint 2). Built on M2–M4 (unmerged); merge after
  them, once its own diff is only M5.
- Migrations: `20261021120000_daily_job.sql` (adds `streams.keep_final_result`;
  `river.mark_stream_follows_ended()` with EXECUTE for river_app; `river.restamp_samples()`,
  `river.daily_job()`; pg_cron job `river-daily` at 04:17 UTC), `20261021120100_sample_spaces.sql`
  (seven sample spaces and 12 items; the seed instance's `seed_follows` and `default_circles`).

**What it does.** `GET /api/feed?mode=&circle=&type=&q=&cursor=` resolves the instance from the
hostname through the new `forHost()`, refreshes the visitor's River (seed follows, resolving any
with no space yet) within a 6 s budget, then answers newest first with circle AND type AND mode
filters, search over `items.search` and the source name, a keyset cursor and an empty flag.
Refresh: spec 4.5's claim statement per space, parallel fetches through the adapters and the fetch
guard, pages upserted on `(space_id, source_id)`, claims released in `finally`, late work under
`waitUntil`; space columns, streams, final results and Ended follows written; quiet hub streams
probed once a day and withdrawn ones hidden. Samples (spec 4.4) are seeded with URNs and SVG
placeholders in `ui/public/samples/`. The daily job does retention, Ended follows, sign-in
bookkeeping (once those tables exist) and sample re-stamping, SQL only.

**Keys.** `TEST_CLOCK_NOW` (test-only, refused on Vercel; CI's `.env` has it), `VERCEL_ENV` (read,
set by Vercel). Test-only: `TEST_ADMIN_DATABASE_URL` (tests read it; postgres for the daily-job
test only). Dependency: `@vercel/functions` ^3.9.11. Helpers: `forHost()`; adapter registry
`src/river/adapters/index.ts`.

**Tests.** `npm run check`: Test Files 17 passed (17), Tests 290 passed (290), UI built.
`npm run test:api` (both dev servers, fresh `db reset`): Test Files 6 passed (6), Tests 56 passed
(56). `npm run test:e2e`: 6 passed. Checks: 1, 2, 5, 6, 23 (visitor), 26 (API part) in
`tests/api/feed.test.ts`; 20, 24, 33 in `tests/api/db/refresh.test.ts`; retention (18's part) in
`tests/api/db/dailyJob.test.ts`. pg_cron 1.6.4 is preloaded in the local stack; the job is
scheduled by the migration (checked in the test).

### Follow-ups
- Adam: after merge, `deploy-migrations` creates the pg_cron job on the dev project. Check
  Database > Cron (or `SELECT * FROM cron.job`) for `river-daily`; pg_cron on hosted is untested
  from here.
- M6: the 404 page for unknown hosts (the API answers JSON 404 `unknown_host`); cards read
  `source`, `space`, `url`, `media` (sample media are same-origin `/samples/*.svg`; podcast and
  video durations sit on the cover's media entry) and `event`; show `refresh.pending` as nothing
  (items arrive on the next open). Boost dereferencing (`dereferenceBoost`, 20 per refresh) is for
  when a boost is opened; no route yet.
- M8/M9: build a member's `ReaderView` (follows, circles, civic-role circle) under `forAccount()`
  and pass it to `scopeFor()`/`queryFeed()`; add mutes (a muted stream inside a followed space)
  to `FeedScope`; refresh a member's follows with `refreshFollowed()`/`refreshSpaces()`. Member
  circles are ids where visitor circles are names.
- M7/M8: the daily job deletes `identity.auth_requests` by `expires_at` and
  `river.auth_attempts` by `created_at`; keep those names or change the job.
- Event start and place: samples keep them in `raw`, fediverse in `raw.object`; the feed returns
  both as `event`. An additive `items.event` column is still a follow-up.

## M4 Fediverse adapter: WebFinger, actor, outbox, NodeInfo, REST fallback, boosts — 2026-10-21

- Branch / PR: claude/m4-fediverse-adapter → PR. Branched from M2 (#6) plus M3's shared base
  (sanitizer, item model; #7), both needs-adam and unmerged. Merge after #6 and #7, once its own
  diff is only M4.
- Migrations: none

**What it does.** `src/river/adapters/fediverse/` resolves `@name@server` and profile URLs (WebFinger,
actor, NodeInfo; Mastodon REST lookup when the actor read is refused), caches the actor 24 h in
`manifest`, reads the outbox's first page (at most 2, stop at the first known item, never
`min_id`), maps public items (replies and non-public hidden; Note/photo/article/video/podcast/
event; Announce → boost), falls back to Mastodon's REST statuses on a 401/403 outbox, else
`blocked`. `dereferenceBoost` with a 20-per-refresh budget. 45 recorded fixtures from the six seed
accounts; recorder in `scripts/recorders/fediverse.ts`.

**Keys.** None.

**Tests.** `fediverseInput`, `fediverseMap`, `fediverseAdapter` (98): check 15 adapter part (real
@w3c WebFinger, actor, NodeInfo, outbox, 2 pages; boosts; replies hidden; resolve from a profile
URL), 22 (a real @eff post with injected script, onerror and javascript: comes out clean, spans
kept), all six seeds read, REST fallback (derived 401 with real statuses, shared source ids),
blocked, refusals with zero requests, 429, boost budget. `npm run check`: Test Files 11 passed
(11), Tests 183 passed (183), UI built.

### Follow-ups
- M5 refresh: `fetchNew(space, { guard, now, isKnown, onPage })`; `isKnown` checks
  `(space_id, source_id)`; store hidden items too; write `fetchStatus`, `lastError`,
  `newestItemAt`, `manifest`; copy `manifest.actor.name`/`iconUrl` to the space when it changes.
  The 120 s minimum is the claim statement's job. One boost budget per refresh. Add
  `src/river/adapters/index.ts` listing both adapters (hub first for URLs).
- Event start time and location live only in `raw`; an additive `event` field is a follow-up.
- Fedizen/Bonfire account not fetched: ADR-001 needs Adam's approval first.
- Seeds: w3c, internetarchive, wikipedia, swf read via ActivityPub; eff and wearenew_public need
  the REST lookup for the profile only. None blocked.
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
