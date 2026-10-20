# Live tests

`@live` tests hit the real seed hubs and fediverse accounts (spec 6, check 32). They run only
through `npm run test:live` (on Adam's machine or in an on-demand thread), never in `npm run check`
or CI. Name files `*.live.test.ts` and put `@live` in each test's name; the first ones arrive with
the adapters (M3, M4) and M11.
