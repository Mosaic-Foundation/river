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

### 2026-10-20 — Where the hostname lookup runs
- Question: CLAUDE.md says every query runs inside forInstance(), forAccount() or forIdentity(),
  but resolving the request's hostname to an instance (ADR-004, check 26) happens before any
  instance id is known.
- Reading used: M1 lets river_app read every `instances` row (instance config is public: name,
  theme, modes, seeds) so the lookup can run without a setting. M6 adds the lookup; it needs a
  wrapper that opens a transaction with no settings (as forIdentity() does today), e.g.
  `forHost()`, which can read `instances` and nothing else (every other river policy requires
  `app.instance_id`).
- Proposed change: CLAUDE.md constraint 2 names that fourth helper.
- Thread / PR: M1 (claude/vibrant-keller-6qnr0g)

### 2026-10-20 — Shared tables still need an instance setting
- Question: spec 3 says shared tables (`spaces`, `streams`, public `items`) "allow read to
  river_app regardless of account". Read literally, a query outside any wrapper could read them.
- Reading used: regardless of account, but not regardless of context: their policies require
  `app.instance_id` to be set. A query that skips forInstance()/forAccount() sees no rows at all,
  which makes a missed wrapper show up in tests instead of silently working.
- Proposed change: spec 3 adds "inside an instance context".
- Thread / PR: M1

### 2026-10-20 — Which settings forIdentity() sets
- Question: CLAUDE.md says forInstance(), forAccount() and forIdentity() all set `app.instance_id`
  and `app.account_id`, but identity tables (spec 3.2) have no instance or River account.
- Reading used: M0's forIdentity() opens a transaction and sets nothing; M7 picks the setting its
  policies read (likely the person's id) when it creates the identity schema.
- Proposed change: CLAUDE.md constraint 2 names the settings per helper.
- Thread / PR: M0 (claude/mosaic-river-v1-m0-8dyv4n)

## Log

## 2026-10-20 — M1 tables, and what waits
- Decision: M1 creates the river schema of spec 3.1 except `login_methods` and `auth_attempts`
  (sign-in, M8) and the hub allowlist table (M3). The `identity` schema exists with
  identity_app's USAGE grant but no tables until M7. No pg_cron job yet (M5).
- Why: check 27 needs accounts, follows, circles, circle members, read state and preferences, and
  those need spaces, streams and items to point at. Sign-in tables belong with the code that
  reads them, and an auth table is a `needs-adam` change of its own.
- Alternatives: all of 3.1 now (an auth table with no code to exercise it); only the five
  personal tables (they'd have nothing to reference).
- Thread / PR: M1 (claude/vibrant-keller-6qnr0g)

## 2026-10-20 — Four kinds of river table, one policy shape each
- Decision: `src/db/tables.ts` lists every table as config (`instances`: read by all, written by
  migrations), instance (`accounts`, `circle_members`), account (`follows`, `circles`,
  `read_state`, `preferences`) or shared (`spaces`, `streams`, `items`). Account tables match
  both settings; `accounts` narrows to the caller's own row once `app.account_id` is set;
  `circle_members` (no account column in 3.1) matches through its circle's owner. The settings
  are read by `river.current_instance_id()` / `river.current_account_id()` (`nullif(..., '')::uuid`,
  wrapped in `(SELECT ...)`). Id columns default to the settings, and composite foreign keys
  `(instance_id, account_id)` refuse a row pointing at another instance's account. `follows`
  checks `(space_id, stream_id)` against streams so a stream rule names a stream of that space.
  river_app gets no DELETE on accounts, spaces, streams or items (the daily job, as postgres,
  does retention); a later milestone grants more when it needs it. A catalog test fails when a
  table exists in one place and not the other.
- Why: spec 3 and ADR-004; the Civic Hub's single-template approach, adapted to three scopes.
- Alternatives: one generic policy keyed on instance only (would let members of one instance read
  each other's rows); an `account_id` column on `circle_members` (not in 3.1).
- Thread / PR: M1

## 2026-10-20 — insert() stamps and refuses; ids are uuids
- Decision: forInstance() and forAccount() callbacks get `insert(table, row)`, which stamps the
  context's `instance_id` (and `account_id` on account tables), throws `ForeignIdError` for a row
  naming another instance or account (case-insensitively), refuses `instances` (migrations only)
  and account tables outside forAccount(), and binds every value. Only checked table and column
  names reach the SQL text. Raw `query()` stays; row-level security refuses the same rows there
  (the database tests show both). Context ids must be uuids and are lowercased.
- Why: spec 3 ("stamp ids on insert, and refuse a payload carrying another instance's or
  account's id"); a non-uuid id would only fail later inside a policy's cast.
- Alternatives: stamping in SQL defaults only (no early, readable refusal); a query builder (a
  dependency for one statement shape).
- Thread / PR: M1

## 2026-10-20 — The seed instance's id and lists
- Decision: the seed instance has the fixed id `00000000-0000-4000-8000-000000000001`.
  `seed_follows` and `default_circles` name spaces as typed in the follow box (hub URL or
  `@name@server`), and the two lists agree (a test checks). Circle colors: Civic `#2F6FA8` (the
  3.3 example), News and ideas `#7A5AA6`, Family `#C2603A`, Soccer `#3C8A4E`, Neighborhood
  `#A8862C`. Family, Soccer and Neighborhood are empty until M5 seeds the samples and adds them
  (and the sample publication and podcast to News and ideas) in its own migration. `plugins` is
  `[]` until M10. `supabase/seed.sql` adds a second instance, `isolation-test.invalid`, for the
  isolation tests; it never reaches the hosted project.
- Why: Appendix D lists the seeds; samples don't exist as spaces before M5.
- Alternatives: a generated id looked up by hostname (every seed script and test would need a
  query before it could open a context).
- Thread / PR: M1

## 2026-10-20 — Column shapes 3.1 left open
- Decision: `items.author` and `items.boost_of` are jsonb (a name, URL and icon; the boosted
  object's details) so M3 and M4 can shape them without a migration. `items.search` is generated
  with the `simple` text-search config over title, summary and `content_html` (the parser drops
  tags); the source name is matched from `spaces` at query time (M5). `items.account_id` has no
  foreign key (items are shared; accounts belong to one instance) and policies keep it null in v1.
  CHECK constraints hold the value lists 3.1 gives (adapter, category, kind, theme, status, rule,
  fetch_status, audience); `modes_enabled` is unconstrained except that `default_mode` is one of
  them, since modes are code plus config.
- Why: spec 3.1 lists these columns without types.
- Alternatives: text columns for author and boost_of; the `english` config (stems words, so a
  search for one form misses another language's).
- Thread / PR: M1

## 2026-10-20 — The app owns database TLS
- Decision: `src/db/pool.ts` reads `sslmode` from `DATABASE_URL` itself and passes pg an explicit
  `ssl` option. Any host but loopback gets TLS with certificate and hostname verification, with
  or without `sslmode`; `require`, `verify-ca` and `verify-full` all mean full verification;
  `disable` is refused off loopback; `prefer`, `allow`, `no-verify`, `ssl=`, `uselibpqcompat` and
  the file parameters are refused with a message. Optional `DATABASE_CA_CERT` (PEM) supplies the
  CA when the server's chain isn't in Node's store. Errors never echo the URL.
- Why: hand-off follow-up from M0. pg 8.23 lets the URL's `sslmode` override an explicit `ssl`
  option, treats require/prefer/verify-ca as verify-full with a deprecation warning, and pg 9
  will give them libpq's meaning (require = encrypt without checking). Owning it here keeps
  verification on across that upgrade and lets a CA be passed at all. Whether Supabase's pooler
  certificate chains to a CA in Node's store is not verified from this session (no hosted
  access); if the first hosted query fails with "self-signed certificate in certificate chain",
  set `DATABASE_CA_CERT` from Dashboard > Database > SSL Configuration.
- Alternatives: `rejectUnauthorized: false` (anyone on the path could read the role password and
  every row); leaving it to pg's URL parsing (changes meaning at pg 9).
- Thread / PR: M1

## 2026-10-20 — Database tests live in tests/api/db/
- Decision: the role and isolation tests connect straight to the local database as river_app and
  identity_app, through the context helpers, under `tests/api/db/`, so `npm run test:api` and
  CI's existing API-tests step run them. CI also connects as each role right after
  `supabase start` and fails if either is not a plain LOGIN role without BYPASSRLS.
- Why: they need the local stack like API tests do, and check 27 is about the database itself,
  which no endpoint exercises yet.
- Alternatives: a separate `tests/db` and `test:db` script (one more CI step and command for the
  same prerequisites).
- Thread / PR: M1

## 2026-10-20 — A pre-existing app role is checked, not altered
- Decision: the roles migration creates each role `NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB
  NOCREATEROLE NOREPLICATION` if missing; if it exists with any of those attributes on, the
  migration raises instead of continuing. It never touches LOGIN or the password, so re-running
  it after Adam sets the hosted password changes nothing.
- Why: migrations run as `postgres`, which on Supabase (hosted and local) has CREATEROLE and
  BYPASSRLS but is not a superuser. Checked locally: it may turn BYPASSRLS off on another role but
  is refused any change to SUPERUSER. A role with those attributes was made by hand, and stopping
  shows that instead of quietly rewriting it.
- Thread / PR: M1

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
