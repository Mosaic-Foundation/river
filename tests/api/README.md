# API tests

API tests call a running dev server over HTTP with `fetch`, against a local Supabase stack.
They never import backend modules directly. This matches the Civic Hub. The server replays
recorded responses (`FETCH_FIXTURES_DIR=tests/fixtures/http`) with its adapter clock fixed at the
recordings' time (`TEST_CLOCK_NOW=2026-10-21T00:00:00.000Z`); both go in `.env`.

To run them:

```bash
npx supabase start          # local Postgres in Docker; applies migrations and supabase/seed.sql
npm run dev &               # API on :3000, reading .env (see .env.example)
npm run test:api
```

Name files `*.test.ts`. Outside services are replaced by fakes behind environment flags
(read through `src/config/env.ts`), never by calls to real third-party APIs.

## Database tests (`db/`)

`db/` holds the one exception to "never import backend modules": tests that connect straight to
the local database as `river_app` and `identity_app` (never `postgres`) and go through
`forInstance()`, `forAccount()` and `forIdentity()` from `src/db/context.ts`, to prove row-level
security and schema isolation (acceptance check 27, ADR-004). They need the local stack but not
the dev server. They connect with `TEST_RIVER_DATABASE_URL` and `TEST_IDENTITY_DATABASE_URL`,
defaulting to the local-only passwords from `supabase/seed.sql`. Each run makes its own accounts
and spaces; `npx supabase db reset` clears them.

The refresh tests (`db/refresh.test.ts`) also call the feed modules directly, with recorded
responses replayed through the real fetch guard and a MockAgent that counts requests.

Two tests connect as the local stack's `postgres` role (`TEST_ADMIN_DATABASE_URL`, default
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`): `db/dailyJob.test.ts`, because the
daily job runs as postgres under pg_cron and river_app can't execute it (it runs inside a
transaction that is rolled back), and `feed.test.ts`'s check-23 count of rows river_app can't
see. App code never connects as postgres.
