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
npm run dev & npm run test:api    # API tests
npm run test:e2e                  # starts the API, the identity host and the UI itself
npm run test:live                 # @live tests against real hosts; never in check or CI
```

## Log

Newest first: date, slice, tests added, counts.

- 2026-10-20, M0: unit `health` (both apps, no DATABASE_URL), `env`, `dbContext`, `dbPool`,
  `vercelHandler`, `lintBoundaries`; e2e `apps` (both /health, identity page and passkey.js),
  `themes` (default Mosaic, Civic tokens, self-hosted fonts, no off-origin requests). Unit 35,
  e2e 5. No API tests yet (they arrive with the first endpoints that use the database).
