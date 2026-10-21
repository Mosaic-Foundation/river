# Live tests

`@live` tests hit the real seed hubs and fediverse accounts (spec 6, check 32). They run only
through `npm run test:live` (on Adam's machine or in an on-demand thread), never in `npm run check`,
`test:api`, `test:e2e` or CI; `tests/unit/liveTests.test.ts` proves that wiring. Name files
`*.live.test.ts` and put `@live` in each test's name.

- `seeds.live.test.ts` (check 32): Demosville, Floyd and Longmont through the Civic Hub adapter, and
  `@w3c@w3c.social` through the fediverse adapter, each resolved and fetched as the River does,
  through the production fetch guard (real DNS, no fixtures). It needs no database, no `.env` and no
  running server: `npm run test:live`. A hub with no item in the last 90 days fails it, as the spec
  asks for at least one item from each.
