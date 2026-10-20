# API tests

API tests call a running dev server over HTTP with `fetch`, against a local Supabase stack.
They never import backend modules directly. This matches the Civic Hub.

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
