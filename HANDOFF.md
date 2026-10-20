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

## M0 Scaffold: two apps from one codebase, pg layer, CI with both servers, themes — 2026-10-20

- Branch / PR: claude/mosaic-river-v1-m0-8dyv4n → PR (needs-adam: CI, Vercel config, database layer)
- Migrations: none (`supabase/config.toml` from `npx supabase init`; `seed.sql` arrives in M1)

**What it does.** `createApp("river" | "identity")` mounts only that side's routes; `/health`
returns `{ ok: true, app }` with no database. `src/river/`, `src/identity/` and `src/shared/` each
have an index and a placeholder route. `identity/` is the `river-identity` Vercel project (its own
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
- Adam: create the `river-identity` Vercel project (Root Directory `identity/`) and confirm
  `/health` on both previews. If its first build shows CommonJS errors, add
  `identity/package.json` with `{"private": true, "type": "module"}` (hand-off 3.2).
- The session's local Supabase stack could not start: Docker Hub answered 429, public.ecr.aws
  "Data limit exceeded", ghcr.io blob downloads 403. No query runs in M0; CI's `supabase start` is
  the proof. The cloud setup script's image pre-pull didn't leave images cached, and dockerd was
  not running at session start (started by hand with `dockerd &`).
- M1: Supabase's pooler needs TLS; check how `sslmode` in `DATABASE_URL` behaves with pg 8's
  verify-full default before the first hosted query.
- CSP (Appendix B) isn't set yet; it belongs with the first pages that load scripts (M6, M7).
