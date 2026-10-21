# Testing

## Principles

- Unit tests (`tests/unit`) need no database and no network. They import code directly.
- API tests (`tests/api`) call a running dev server over HTTP against a local Supabase stack.
  They never import backend modules.
- End-to-end tests (`tests/e2e`) drive the UI in Chromium. Every acceptance check in the spec
  becomes one of these.
- Outside services are faked behind environment flags read through `src/config/env.ts`.
- A test that needs something unavailable fails with a clear message; it is never skipped
  silently.

## Quick start

```bash
npm run check                     # lint, typecheck, unit, UI lint + build
npx supabase start                # once per session, for API and e2e tests
npm run dev & npm run test:api    # API tests, including tests/api/db/ (as river_app, identity_app)
npm run test:e2e                  # starts the API, the identity host and the UI itself
npm run test:live                 # @live tests against real hosts; never in check or CI
```

## Log

Newest first: date, slice, tests added, counts.

- 2026-10-21, M4: unit `fediverseInput`, `fediverseMap`, `fediverseAdapter` (check 15 adapter
  part, 22, all six seeds, REST fallback, blocked, refusals, 429, boost budget). Fixtures: 45
  recorded fediverse responses; derived cases built at run time in
  `tests/unit/helpers/fediverseFixtures.ts`. Unit 183 on this branch (M3's tests live on #7).
- 2026-10-21, M3: unit `sanitize` (check 22 sanitizer half, allowlist, https-only links) and
  `civicHub/` (`allowlist`, `hubTemplates`, `map`, `adapter`: checks 18 adapter part, 22, 25,
  plus 13/14/16 through resolve). Fixtures: 36 recorded hub responses; derived cases inline and
  labelled. Unit 174.
- 2026-10-21, M2: unit `fetchGuard` (address table from the hub; check 16 with an injected
  resolver and a counting MockAgent: refused, F6 wording, zero requests; redirect targets never
  requested; pinned lookup and rebinding; redirects; 2 MB; timeout; 2 per host; Retry-After;
  304/HEAD; abort; fixture write, load and replay) and `lintBoundaries` (network imports, global
  fetch). Mutation check on three guard checks. Unit 94.
- 2026-10-20, M1: API (database) `db/catalog` (roles have no SUPERUSER, BYPASSRLS, CREATEROLE,
  CREATEDB or REPLICATION; each has USAGE on its own schema only; river tables match
  `src/db/tables.ts`, all with ENABLE + FORCE RLS and river_app-only policies; seed instance and
  its lists; river_app can't write config) and `db/isolation` (check 27, all as river_app:
  members see only their own follows, circles, circle members, read state, preferences and
  account; can't read, change, delete or write the other's; plain SQL refused by RLS alone;
  instance context sees no personal rows; cross-instance refused by policy and composite key; no
  rows outside a context; river_app denied the identity schema, identity_app the river schema).
  Unit `dbContext` grows stamping, refusal, uuid ids; `dbPool` grows TLS rules. Unit 48, API 19,
  e2e 5. Mutation check: weakening the follows policy or dropping FORCE on one table fails 6.
- 2026-10-20, M0: unit `health` (both apps, no DATABASE_URL), `env`, `dbContext`, `dbPool`,
  `vercelHandler`, `lintBoundaries`; e2e `apps` (both /health, identity page and passkey.js),
  `themes` (default Mosaic, Civic tokens, self-hosted fonts, no off-origin requests). Unit 35,
  e2e 5. No API tests yet (they arrive with the first endpoints that use the database).
