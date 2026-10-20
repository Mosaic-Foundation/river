# Decisions

Newest first. One entry per decision the spec didn't settle. Keep each entry short.

Format:

```
## YYYY-MM-DD — <decision in a few words>
- Decision: what was chosen
- Why: one or two lines tied to the spec
- Alternatives: what else was considered
- Thread / PR: link
```

## Spec questions

Places where the spec looked contradictory or wrong, and the reading that was used.

### 2026-10-20 — Which settings forIdentity() sets
- Question: CLAUDE.md says forInstance(), forAccount() and forIdentity() all set `app.instance_id`
  and `app.account_id`, but identity tables (spec 3.2) have no instance or River account.
- Reading used: M0's forIdentity() opens a transaction and sets nothing; M7 picks the setting its
  policies read (likely the person's id) when it creates the identity schema.
- Proposed change: CLAUDE.md constraint 2 names the settings per helper.
- Thread / PR: M0 (claude/mosaic-river-v1-m0-8dyv4n)

## Log

## 2026-10-20 — The identity host's Vercel project is mosaic-id
- Decision: the identity host deploys as the Vercel project `mosaic-id` (Root Directory
  `identity/`), not `river-identity`. The River's project stays `river`. ADR-006, spec Appendix A
  and hand-off 3.2 still say `river-identity`; read that name as `mosaic-id`.
- Why: Adam's call (2026-10-20). The identity service will stand apart from the River long term
  (ADR-006 already plans for it to move or be replaced without touching River code), so its
  project carries the Mosaic name. Nothing in the code depends on the project name.
- Alternatives: `river-identity`, as ADR-006 names it.
- Proposed change: update the project name in ADR-006 and spec Appendix A when they're next
  revised (an ADR change is `needs-adam`).
- Thread / PR: M0 (claude/mosaic-river-v1-m0-8dyv4n)

## 2026-10-20 — Local Supabase runs only Postgres
- Decision: `supabase/config.toml` turns off the Data API, Auth, Storage, Realtime, Studio, mail
  capture, edge runtime and analytics; `npx supabase start` runs just the database.
- Why: both apps use `pg` as their own roles and expose no schema through the Data API (spec 3,
  ADR-004); no proprietary auth (constraint 4). Fewer images make CI and sessions start faster.
- Alternatives: the CLI defaults (pulls about ten images nothing uses).
- Thread / PR: M0

## 2026-10-20 — Context helpers bind setting names too
- Decision: `SELECT set_config($1, $2, true), set_config($3, $4, true)` with names and values as
  bind parameters; callbacks get a `Db` with only `query(text, values)`, so no statement name can
  be passed. M0 stubs do the transaction and settings; M1 adds stamping and payload refusal.
  Empty ids are refused before a client is taken; a client whose ROLLBACK fails is destroyed.
- Why: spec 3 and constraint 2 (no SQL splicing, no named statements through the pooler).
- Alternatives: splicing constant names into the SQL text (safe, but one more thing to review).
- Thread / PR: M0

## 2026-10-20 — Test-only variables fail the deployment
- Decision: reading `FETCH_FIXTURES_DIR` or `TEST_ROUTES` throws when `VERCEL` is set, and
  `createApp()` calls `checkEnv()`, so a deployment with either set fails `/health` at once.
  `checkEnv()` also validates `APP` and `EMAIL_TRANSPORT` (default `log`, the redacted transport).
- Why: hand-off 3.2 item 5 ("refuse to load when VERCEL is set"); a lazy getter alone would not
  notice until a route read it.
- Alternatives: warn and ignore the variable.
- Thread / PR: M0

## 2026-10-20 — One set of semantic theme tokens
- Decision: `mosaic.css` (on `:root` and `[data-theme="mosaic"]`) and `civic.css`
  (`[data-theme="civic"]`) each define palette primitives (`--mosaic-*`, `--civic-*`) and the same
  semantic tokens (`--color-bg`, `--color-primary`, `--font-heading`, `--radius-md`,
  `--shadow-card`, ...). Components use only the semantic names. Civic's muted text (`#5a6b6e`)
  and danger (`#a03a2a`) are derived, since the canonical palette has neither.
- Why: Civic mode (M10) switches themes by changing one attribute on `<html>`.
- Alternatives: separate stylesheets loaded per mode (a flash of the wrong theme on switch).
- Thread / PR: M0

## 2026-10-20 — Script and test conventions from M0
- Decision: `@live` tests live in `tests/live/*.live.test.ts` with `@live` in each test name,
  run by `vitest.live.config.ts`. `record-fixtures` is a registry of recorders that M3 and M4
  fill; with none it fetches nothing and says so. The identity bundle is
  `identity/public/passkey.js` (gitignored, built by Vercel and by the e2e webServer). The pg lint
  rule also blocks `pg/*` and `pg-*` (e.g. `pg-pool`). The River's API root (`/api/`) returns
  `{ app, name }` as its placeholder route. No `identity/package.json` yet: hand-off 3.2 adds one
  only if the first Vercel build shows CommonJS errors.
- Why: hand-off 3.2 items 1, 4 and 6 leave these details open.
- Thread / PR: M0
