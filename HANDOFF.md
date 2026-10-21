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

## UI revisions 1, item 1: the reader view — 2026-10-21

- Branch / PR: claude/eloquent-newton-v3ftlr → PR 3 of the UI revisions series (self-merge)
- Migrations: none.

**What it does.** A click anywhere on a card (outside its links and buttons) opens the item at
`/item/{id}` inside the River, sidebar still visible: full sanitized content, all images, author,
source, details, "Open original" (new tab, `noopener noreferrer`, live items only) and Mark
read/unread. "Back to River" and the browser's Back return to the same scroll position and focus
the opened card. Card footers show only the source host. New `GET /api/items/{id}` (reader's own
follows, 404 otherwise) serves a reloaded or shared item link; nothing is fetched from outside.

**Keys.** None.

**Tests.** API `feed` (one item: live and sample equal to the feed's, 404, 400, nothing outside
the follows); e2e `revisions.spec.ts` item 1 (six tests); `river.spec.ts` check 4 rewritten for
the host footer and Open original; visitor and member read-state tests open items in the reader.

### Follow-ups
- Spec F1's "Open on {host}" card link is superseded by ui-revisions-1 item 1.

## UI revisions 1, items 2-4: toggle pills, active filter chips, Networks — 2026-10-21

- Branch / PR: claude/eloquent-newton-v3ftlr → PR 2 of the UI revisions series (self-merge)
- Migrations: none.

**What it does.** Content types are toggle pills (several at once, dark fill and a check mark,
none means All) on desktop and in the phone chip row; the phone's type select is gone. A
Networks section (Civic Hubs; Fediverse, "Mastodon and compatible") works the same way. Circles,
Content type and Networks collapse from their heading buttons. Above the feed, one chip per active
filter with an ✕, plus "Clear all". `/api/feed` and `POST /api/read-state/all` take `type` as a
comma-separated list and a new `network` list (DECISIONS.md).

**Keys.** None.

**Tests.** Unit `feedScope` (parseContentTypes, parseNetworks), `ui/format` (parseList,
toggleValue, the query string); API `feed` (several types, each network, both); e2e
`revisions.spec.ts` items 2, 3, 4; `river.spec.ts` check 30 uses the phone pills.

### Follow-ups
- Collapsed sections aren't remembered across reloads.

## UI revisions 1, items 5 and 8: Civic circles and the Sample River line — 2026-10-21

- Branch / PR: claude/eloquent-newton-v3ftlr → PR 1 of the UI revisions series (self-merge)
- Migrations: none.

**What it does.** Adds `docs/spec/ui-revisions-1.md` (Adam's eight UI revisions with acceptance
checks). Civic mode now lists only the `role = civic` circle (plus All) in the sidebar and the
phone chip row; switching to Civic from another circle falls back to All. Visitors see one line
above the header: "Sample River · Sign in to make it your own".

**Keys.** None.

**Tests.** e2e `revisions.spec.ts` (items 5 and 8); `modes.spec.ts` checks a member sees no
sample line. `npm run check` green.

### Follow-ups
- Items 1, 2, 3, 4, 6, 7 follow in their own PRs.

## Production fix: sanitize-html loads under Vercel's CommonJS loader — 2026-10-21

- Branch / PR: claude/sanitize-html-esm-commonjs-cu2n3p → PR (self-merge; no needs-adam file)
- Migrations: none.

**What it does.** Production was down on both Vercel projects: every function crashed at load with
ERR_REQUIRE_ESM because sanitize-html 2.18.1 pulls in htmlparser2 12 (ES-only) and Vercel's loader
require()s it. Plain Node 24 can, so CI passed. `package.json` now overrides sanitize-html's
htmlparser2 to ^10.1.0 (CommonJS build; output unchanged, `npm audit` clean). `identity/package.json`
sets Node 24.x for the mosaic-id project.

**Keys.** None.

**Tests.** Unit `sanitizeCjsLoad` reproduces the Vercel loader with `--no-experimental-require-module`
(fails without the override). `npm run check`: 32 files, 453 tests passed; UI build green.

### Follow-ups
- Drop the override once sanitize-html ships a build that loads under require() without it.

## M11 Finish: member export, @live tests, feed performance report, deploy checklist — 2026-10-21

- Branch / PR: claude/m11-finish → PR. Built on M5–M10 (unmerged); merge after them, once its own
  diff is only M11. No needs-adam trigger of its own: no migration, no table, policy or grant
  change, no auth or session change (the export route only uses `readSession()` and
  `requireMember()`), no new outbound host in app code (the @live tests and the perf script are
  not app code; @live goes through the fetch guard to the seed hosts ADR-001 already covers), no
  `.github/`, `vercel.json` or CLAUDE.md change. The production deploy is not done: it needs Adam.
- Migrations: none.

**What it does.** `GET /api/me/export` (check 29) returns a member's follows, circles and
preferences in spec 3.3's shape as a JSON download (`src/river/export/`), read in one forAccount()
transaction; visitors get 401. Follows are active rules (whole space, stream follow, stream mute)
by canonical URL and stream key, with the names of their space's circles; seeds still waiting for
their space are exported as follows. `tests/live/seeds.live.test.ts` (check 32) reads the three
seed hubs and @w3c@w3c.social through the adapters and the production fetch guard; only `npm run
test:live` runs it. `scripts/perf-feed.ts` (check 34) times `GET /api/feed` for a member with 20
follows and a warm cache; `docs/perf/feed-report.md` has the numbers: 25 ms median, 32 ms p95 for
a member's first page locally. `docs/deploy.md` is the production checklist with each Vercel
project's variables, names only.

**Keys.** None. Route `GET /api/me/export`. Test helper `tests/api/helpers/member.ts`.

**Tests.** `npm run check`: Test Files 31 passed (31), Tests 452 passed (452), UI built.
`npm run test:api` (both dev servers, fresh `db reset`): Test Files 14 passed (14), Tests 136
passed (136). `npm run test:e2e` (fresh `db reset`): 47 passed, against the dev servers. Check 29
in `tests/e2e/export.spec.ts`, `tests/api/export.test.ts` and `tests/unit/riverExport.test.ts`;
check 32 in `tests/live/seeds.live.test.ts` (not run here), its isolation in
`tests/unit/liveTests.test.ts`; check 34 in `docs/perf/feed-report.md`. This thread's worktree has
no `.env` files: the dev servers got their settings from the environment (as CI's `.env` lists
them), and check 37's `recover-dids` subprocess now reads `.env.identity` only if present so the
same works there. The e2e run wasn't repeated against `vite preview` on 4173 (CI does that).

### Follow-ups
- Adam: run `npm run test:live` once (check 32); it contacts the three hubs and w3c.social.
- Adam: production deploy per `docs/deploy.md` (merges, role passwords, both Vercel projects'
  variables, DNS, Resend records, smoke).
- The UI has no "Download my data" link yet (3.3: "API in v1, screen later"); the You tab is the
  natural place.
- Spec questions logged: the export's circles carry no members; ended stream rules in the export;
  "20 follows" with 16 recorded sources; what "renders" means for a Vitest @live test.
- `signin.test.ts` and `following.test.ts` still carry their own copy of the sign-in helper; they
  could move to `tests/api/helpers/member.ts`.

## M10 Modes and plugins: mode switch, Civic theme, panel surface, plugin registry, Coming up — 2026-10-21

- Branch / PR: claude/m10-modes-plugins → PR. Built on M5–M9 (unmerged); merge after them, once
  its own diff is only M10. No needs-adam trigger of its own: no migration, no table, policy or
  grant change, no auth or session change, no new outbound host (plugins make no request), no
  `.github/`, `vercel.json` or CLAUDE.md change. Touches `eslint.config.js` (a new plugin rule)
  and `ui/src/styles/themes/civic.css` (one token).
- Migrations: none.

**What it does.** Modes are definitions in code (`src/river/modes/`): Everything (all follows,
Mosaic, no panel) and Civic (civic-category spaces plus the reader's circle whose `role` is civic,
found by role, never by name; Civic theme; the panel). The header's Everything | Civic switch
shows the instance's `modes_enabled` and hides when there is one; an instance with only Civic opens
in it (check 8). The mode lives in `?mode=`; links to the Following page keep it and that page
wears its theme. Plugins (`src/river/plugins/`): manifests in the spec's shape, checked at load; a
registry of first-party plugins; each runs in-process on the feed's first page with a frozen
ViewApi (the current view's items, newest 500, and the River's clock) and returns data the UI
draws. v1 plugins on `river.panel`: Coming up (up to 5 upcoming deadlines and event starts, date
order, hidden when none) and the two placeholder slots naming Open States, Geocodio or Cicero and
Democracy Works or Ballotpedia. Lint keeps built-in plugins importing only their ViewApi.

**Keys.** None. Feed response gains `modes` ([{id, title}]), `theme` and `surfaces`
(`{"river.panel": [{id, title, version, output}]}` on the first page, `null` on later ones);
`bad_mode` 400 for a mode the instance doesn't offer (the UI opens the default). `POST
/api/read-state/all` now gets the mode from the UI. `instances.plugins` entries `{id, enabled:
false}` turn a plugin off (seed row unchanged). Layout tokens `--layout-panel`,
`--layout-page-wide`. UI stylesheet `ui/src/styles/modes.css`. No new dependency.

**Tests.** `npm run check`: Test Files 29 passed (29), Tests 437 passed (437), UI built.
`npm run test:api` (both dev servers, fresh `db reset`): Test Files 13 passed (13), Tests 132
passed (132). `npm run test:e2e` (fresh `db reset`): 46 passed, against the dev servers and again
against `vite preview` on 4173. Checks 7 and 8 in `tests/e2e/modes.spec.ts`, with database proofs
in `tests/api/db/modes.test.ts`, HTTP proofs in `tests/api/modes.test.ts` and logic in
`tests/unit/plugins.test.ts` and `tests/unit/ui/modes.test.ts`. Check 8's instance is inserted as
postgres under a random `civic-only-*.localhost` hostname and deleted afterwards.

### Follow-ups
- Adam: on a preview, switch to Civic and check the panel and theme; on a phone the panel sits
  above the feed and takes most of the first screen (the placeholders could fold away later).
- `river.mode-header` and `river.card-action` are valid surfaces with no v1 plugin; a card action
  would need an item-level ViewApi (one item) and a per-card output type.
- A member's chosen mode isn't saved (`preferences` could hold it); the URL keeps it per tab.
- Spec questions logged: `instances.theme` next to the modes' themes; "the current items" for
  Coming up (read as the whole view); plugins with empty capabilities.
- M11: `GET /api/me/export`'s `preferences` stays `{}` (no mode preference yet).

## M9 Following: follow box, Following page, stream rules, Ended, Quiet, circles — 2026-10-21

- Branch / PR: claude/m9-following → PR. Built on M5–M8 (unmerged); merge after them, once its own
  diff is only M9. No needs-adam trigger of its own: no migration, no grant or policy change, no
  auth/session change (it only uses `readSession()`/`requireMember()`/`checkOrigin()`), no new
  outbound host (resolve goes through the existing adapters and fetch guard), no `.github/`,
  `vercel.json` or CLAUDE.md change.
- Migrations: none (M1's grants cover follows, circles and circle_members writes).

**What it does.** Members get the follow box (F6): one field for a URL or `@name@server`,
resolved hub-first then fediverse (fallback on "not a Space"), previewed with name, icon or
initials, kind and address; a single hub process offers "Just this stream (ends on its own when
the process ends)" or "The whole space"; circles are picked and the follow is stored in
`forAccount()`, then refreshed through `refreshSpaces()`. Errors are exactly F6's four sentences.
The Following page (`/following`; the phone's Following tab) has Spaces grouped by kind with
collapsible hub streams (Mute, Follow just this, Unmute, Stop following; "until the process
ends"), Quiet (90 days, never samples, banner with "Unfollow all quiet spaces") and Ended (Remove;
cleared by the daily job). The feed applies the rules: a muted stream stays hidden inside a
followed space, a followed stream shows alone, ended follows keep showing what they stored.
Circles (F8; desktop beside the page, the phone's Circles tab): create, rename, recolor, delete,
add/remove followed spaces; the civic circle keeps its role and can't be deleted. Visitors get a
sign-up prompt.

**Keys.** None. Routes: `POST /api/follow/preview`, `POST /api/follows`, `GET /api/following`,
`DELETE /api/following/spaces/:id`, `PUT /api/following/streams/:id`, `DELETE
/api/following/rules/:id`, `POST /api/following/quiet/unfollow`, `POST /api/circles`,
`PATCH|DELETE /api/circles/:id`, `PUT|DELETE /api/circles/:id/spaces/:spaceId`. UI route
`/following`. Layout tokens `--layout-following`, `--layout-circles`, `--layout-row-text`,
`--layout-stream-title`. No new dependency.

**Tests.** `npm run check`: Test Files 27 passed (27), Tests 401 passed (401), UI built.
`npm run test:api` (both dev servers, fresh `db reset`): Test Files 11 passed (11), Tests 122
passed (122). `npm run test:e2e`: 42 passed, against the dev servers and again against `vite
preview` on 4173. Checks 13, 14, 15, 17, 18, 19 in `tests/e2e/following.spec.ts`, with database
proofs in `tests/api/db/following.test.ts` and HTTP proofs in `tests/api/following.test.ts`;
check 27 extended there to the new writes.

### Follow-ups
- M10: Civic mode reads the `role = civic` circle by role, not name (renaming keeps the role).
  The Following page has no mode picker; it could take the Civic theme in Civic mode.
- M11: `GET /api/me/export` can reuse `followingPage()` (follows with stream keys, circles); a
  stream rule's `url` is the space's canonical URL plus `stream_key`.
- Check 20's "quiet error note on Following": the Following page shows `last_error` under a space
  whose last refresh failed; no test times a fetch out end to end yet (M5 proves the budget).
- A hub space lists at most 25 known streams; a stream not among them can still be followed by
  pasting its URL. A search over a hub's streams would help busy hubs.
- Fediverse avatars on the Following page load straight from their hosts (CSP img-src https:);
  e2e blocks them, so the page shows initials there.
- Spec question logged: a stream-only follow's final result leaves the member's River when the
  Ended follow is cleared after 90 days.

## M8 Sign-in: the note, auth_attempts, sessions, accounts, login methods, seed copy, member read state — 2026-10-21

- Branch / PR: claude/m8-sign-in → PR (needs-adam: authentication and sessions, a migration
  with RLS and SECURITY DEFINER functions, a new file in `src/shared/fetch/`, `vercel.json`,
  `.github/`). Built on M5–M7 (unmerged); merge after them, once its own diff is only M8.
- Migrations: `20261021180000_sign_in.sql` (`river.login_methods`, `river.auth_attempts`, ENABLE +
  FORCE RLS, river_app policies and grants; `river.account_for_login()` and
  `river.consume_auth_attempt()`, EXECUTE for river_app only). No existing table changed.

**What it does.** Sign up and Sign in (header, You tab, Follow dialog) go to `GET
/api/auth/signin`: an auth_attempts row, a 10-minute `__Host-river-signin` cookie and a redirect
to `{IDENTITY_ORIGIN}/authorize`. `GET /api/auth/callback` runs spec 4.6 step 4 exactly
(`src/river/auth/note.ts`): state cookie, atomic consume, EdDSA only, iss = sub, kid of that DID,
trusted host, aud, nonce, iat/exp with 60 s leeway, the DID log read through the fetch guard
(10-minute cache), verified with didwebvh-ts, the key from the CURRENT document's
`authentication` (a cached document that fails is re-read once, so recover-dids works). Success:
the account by (instance, did, SCID), made on first sign-in with the seed follows and default
circles (Civic's role included), a 30-day `__Host-river-session` cookie (signed, stateless),
no-referrer, 303 to `/`. Failure: 401 page, no session. Sign out clears it. Members' feeds come
from their own rows under forAccount() with read state; Mark read / unread / all read and opening
a link write `river.read_state`; visitors keep localStorage. Every non-GET River route checks
Origin. Lint now enforces constraint 7.

**Keys.** `TEST_DID_LOOPBACK` (test-only, refused on Vercel): read a trusted loopback DID host's
log over http (`src/shared/fetch/loopback.ts`). `SESSION_SECRET` is now required by the River (at
least 32 characters). `TRUSTED_DID_HOSTS` entries are host[:port] (local and CI:
`localhost:3001,localhost:3005`). Feed response gains `viewer` and members' `read`. Routes `GET
/api/auth/signin`, `GET /api/auth/callback`, `POST /api/auth/signout`, `POST /api/read-state`,
`POST /api/read-state/all`. No new dependency.

**Tests.** `npm run check`: Test Files 26 passed (26), Tests 388 passed (388), UI built.
`npm run test:api` (both dev servers, fresh `db reset`): Test Files 9 passed (9), Tests 109 passed
(109). `npm run test:e2e`: 36 passed, against the dev servers and again against `vite preview` on
4173. Check 10 and 23 (member) in `tests/e2e/signin.spec.ts`; check 11 in
`tests/unit/riverSignIn.test.ts` (by reason) and `tests/api/signin.test.ts` (over HTTP); 36 and 37
River part in `tests/e2e/identity.spec.ts`; 27 with real sign-ups in `tests/api/db/isolation.test.ts`.

### Follow-ups
- **Adam:** set `SESSION_SECRET` (e.g. `openssl rand -hex 32`, different per project) on `river`
  (now required for sign-in) and on `mosaic-id` (still unused there). On `river` set
  `RIVER_PUBLIC_ORIGIN` (exactly the origin listed in the identity host's `RIVER_CLIENT_ORIGINS`),
  `IDENTITY_ORIGIN` (the `mosaic-id` production origin) and `TRUSTED_DID_HOSTS` (that origin's
  host; `id.mosaic.social` after DNS). Never set `TEST_DID_LOOPBACK` on Vercel (it fails /health).
- Adam: on a production deployment (previews can't sign in), sign up from the River and check:
  you land on `/` signed in, the response to `/api/auth/callback` carries `Referrer-Policy:
  no-referrer` (vercel.json now adds it for `/api/auth/*` too), and Sign out works.
- Sessions are stateless: sign-out ends this browser's session, but a copied cookie stays valid
  for 30 days unless `SESSION_SECRET` changes (DECISIONS). A sessions table is the upgrade.
- M9: follows are read with `rule = follow` only, ended follows included; add mutes to the scope,
  the Ended and Quiet tabs, the follow box (members only now: `res.locals.viewer`) and circle
  editing (member circles are uuids; the chips already send ids). New follows go through
  `refreshFollowed()`/`refreshSpaces()` like the seed copy. The `seed_pending` preference holds
  seed names that had no space at sign-up; keep it working or fold it into the follow flow.
- M9/M10: `accounts.display_name` is never set (the note carries no name); the UI shows the DID. A
  "Your name" field on the You tab would be a small addition.
- M10: the mode switch can keep using `GET /api/feed?mode=`; members' civic circle is the circle
  with `role = civic`.
- M11: `GET /api/me/export` can read the member through `readSession()` + `requireMember()`.
- A visitor's localStorage read marks are not moved to the account at sign-up (spec doesn't ask).

## M7 Identity host: passkeys, did:webvh, sealed keys, audit log, authorize, email and recovery — 2026-10-21

- Branch / PR: claude/m7-identity-host → PR (needs-adam: authentication, `src/identity/keys/`,
  `src/identity/recovery/`, a new migration with RLS, `identity/vercel.json`, `.github/`, the
  identity host's use of `api.resend.com`, CLAUDE.md Commands). Built on M2–M6 (unmerged);
  merge after them, once its own diff is only M7.
- Migrations: `20261021140000_identity_tables.sql` (people, passkeys, did_log, keys,
  auth_requests, audit_log, recovery_tokens; ENABLE + FORCE RLS; identity_app-only policies and
  grants; six SECURITY DEFINER lookups). River schema unchanged.

**What it does.** `/authorize` checks `client_id` and the exact `redirect_uri` against the clients
built from RIVER_CLIENT_ORIGINS, stores an auth request (10 min) and serves the page. People sign
in with a discoverable passkey, or sign up with an email address and a new passkey: one
transaction marks the request used, creates an Ed25519 key, a `did:webvh:{SCID}:{host}:u:{code}`
log (didwebvh-ts 2.8.0; `portable: true`; update keys = the person's key and
IDENTITY_RECOVERY_PUBLIC_KEY; `#key-1` authenticates), seals the key (per-person AES-256-GCM key
wrapped by IDENTITY_MASTER_KEY, DID as AAD), stores the passkey, audits everything and signs the
note: `redirect_uri?state=…&note={jws}` (EdDSA, `kid {did}#key-1`, `{iss, sub, aud, nonce, iat,
exp = iat + 120}`). `GET /u/{code}/did.jsonl` serves the log as `text/jsonl`. Email: a 24-hour
verify link on sign-up (the account works at once; a reminder shows until it's confirmed),
"Lost your passkey?" (same answer always; a single-use 15-minute link for verified addresses
that adds a passkey to the same person and DID and continues the sign-in; notice email), change
email after a fresh passkey check (link to the new address, notice to the old). Transports
`log` / `capture` / `resend`. `npm run recover-dids` re-keys DIDs with the offline recovery key.
Pages are server-rendered with no inline script under the Appendix B CSP; `passkey.js` runs the
ceremonies. No identity-host session at all (DECISIONS).

**Keys.** `IDENTITY_RECOVERY_PUBLIC_KEY` (identity host; public half, multikey). `VERCEL` now read
through env.ts (`env.onVercel`). Test-only: `TEST_RECOVERY_KEY_FILE` (e2e, path to the run's
throwaway key), `IDENTITY_API_URL` (API tests, default :3001). Dependencies:
`@simplewebauthn/server` 14.0.3, `didwebvh-ts` 2.8.0, dev `@simplewebauthn/browser` 14.0.0.
Script `recover-dids` (reads `.env.recover` if present). Test routes under `/test/` with
TEST_ROUTES. `forIdentity(scope, fn)` now takes `{ personId?, authRequestId? }`.

**Tests.** `npm run check`: Test Files 24 passed (24), Tests 344 passed (344), UI built.
`npm run test:api` (both dev servers, fresh `db reset`): Test Files 8 passed (8), Tests 84 passed
(84). `npm run test:e2e`: 31 passed, against the dev servers and again against `vite preview` on
4173 (CI's path). Checks 9, 12, 28, 35, 36, 37 in `tests/e2e/identity.spec.ts`
(Chromium virtual authenticator); 27's identity part, 28 and 37 also in
`tests/api/db/identity.test.ts`; check 12 and options in `tests/api/identity.test.ts`.

### Follow-ups
- **Adam, before the identity host is used for real:** generate the recovery key pair offline
  (`openssl genpkey -algorithm ed25519 -out recovery.pem` on a machine you trust; keep it offline
  with the master key's copy), print its public half with
  `npm run recover-dids -- --print-public-key --key-file /path/recovery.pem`, and set
  `IDENTITY_RECOVERY_PUBLIC_KEY` on the `mosaic-id` Vercel project. Also set
  `IDENTITY_MASTER_KEY` (32 random bytes, base64), `RP_ID` (the identity host's name: the
  vercel.app host until DNS, then `id.mosaic.social`; passkeys and DIDs made under one name don't
  move), `IDENTITY_PUBLIC_ORIGIN`, `RIVER_CLIENT_ORIGINS`, `EMAIL_TRANSPORT=resend`,
  `RESEND_API_KEY`, `EMAIL_FROM` and Resend's SPF/DKIM records for mosaic.social. Until then keep
  `EMAIL_TRANSPORT=log` (links are not delivered; nobody can verify or recover).
- Adam: check a `mosaic-id` preview: `/authorize` from the River's origin renders, passkey.js
  loads with no CSP violation in the console, and `/u/{code}/did.jsonl` answers `text/jsonl`.
- M8 (River sign-in): verify exactly this note. The DID document's `authentication` lists
  `{did}#key-1` (absolute id) with a `Multikey` `publicKeyMultibase`; resolve with
  `resolveDIDFromLog` over a log fetched through the fetch guard, never the library's
  `resolveDID()` (it uses global fetch). Locally the DID host is `localhost%3A3001` and its log is
  at `http://localhost:3001/u/{code}/did.jsonl`, which the https-only guard refuses: M8 needs a
  local-only path (e.g. reading the log over loopback when TRUSTED_DID_HOSTS is `localhost`, test
  routes only) or fixtures. After recover-dids the note is signed by the new key; resolve the
  current document, not the first entry. `aud` is the River origin exactly as listed in
  RIVER_CLIENT_ORIGINS. Prove check 37's "same River account" there.
- M8: the River's callback is `{origin}/api/auth/callback`; the e2e helpers answer it in the
  browser today (`catchCallback`). Replace that with the real callback.
- Sign-up says when an address is taken (Spec questions). Rate limits are per warm instance on
  Vercel (DECISIONS); a durable counter table is a later option.
- "Send the link again" goes through the change-email page with a passkey check; a one-click
  resend on the reminder would need an identity-host session.
- No screen to list or remove passkeys (spec 5); no account deletion.

## M6 River UI: Everything mode on desktop and phone, Live and Sample cards, images, CSP — 2026-10-21

- Branch / PR: claude/m6-river-ui → PR (needs-adam: `vercel.json` gains the CSP header). Built on
  M2–M5 (unmerged); merge after them, once its own diff is only M6.
- Migrations: none

**What it does.** `/` is the feed from `GET /api/feed`, in Everything mode with the Mosaic theme.
Desktop: search, circles and content type in the left column. Phone (below 56rem): header with
search toggle and Follow, a chip row (content-type select, circle chips), compact cards, bottom
tabs Feed, Circles, Following, You (the last three are placeholders that say what comes later).
Cards show the source icon (avatar, else initials), name, kind, relative time, Live or Sample
(Sample opens the F1 explainer in a native `<dialog>`; Escape closes it and focus returns), boost
line, title, sanitized `contentHtml` (the only HTML rendered) or the summary as text, event date
and place, civic label and deadline, duration, images (lazy, no referrer, https or `/samples/`,
removed on error), "Open on {host}" for live items, Mark read/unread, an unread dot. "Mark all read"
covers the loaded view; visitor read state is in localStorage only. "Load more" pages by cursor.
`unknown_host` from the API shows the 404 page; other paths show a not-found page. The CSP lives
in `vercel.json`; `vite preview` serves the same header and the dev server adds a nonce.

**Keys.** None. Dev dependency `@axe-core/playwright` ^4.14.0. Layout tokens (`--size-*`,
`--layout-*`, `--border-width`, bold weights) in `ui/src/styles/theme.css`. Vite proxy now keeps
the browser's Host (`changeOrigin: false`).

**Tests.** `npm run check`: Test Files 20 passed (20), Tests 308 passed (308), UI built.
`npm run test:api` (both dev servers, fresh `db reset`): Test Files 6 passed (6), Tests 56 passed
(56). `npm run test:e2e`: 22 passed, against the dev servers and again against `vite preview` on
4173 (CI's path). Checks 3, 4, 21, 26 (UI), 30, 31 in `tests/e2e/river.spec.ts`; every e2e spec
uses `tests/e2e/fixtures.ts`, which aborts any request off loopback.

### Follow-ups
- Adam: `vercel.json` now sends the CSP on every path. Check a preview: the feed loads, live
  avatars and images load from their hosts, and the console shows no CSP violations.
- The unknown-host page has HTTP status 200 on Vercel (static `index.html`); only the API answers
  404. A real 404 status needs an edge function per page view (DECISIONS).
- M8: replace the visitor read state with the member's server read state when signed in (keep
  localStorage for visitors); "Follow" and the You tab become sign-up/sign-in; Mark read then
  writes through the API.
- M9: the Following tab and page; the Follow dialog becomes the follow box (F6); the Circles tab
  becomes circle editing. Member circles are ids, visitor circles names: the chips send `circle=`
  by name today (`ui/src/lib/api.ts`).
- M10: mode picker in the header (phone and desktop), `data-theme` from the mode (River.tsx sets
  it from the feed's `mode` already), the panel beside the feed (the desktop grid has room for a
  third column), Civic copy for the 404 page if wanted.
- Boost cards say "The boosted post opens where it lives." when the boost has no content;
  dereferencing a boost on open (M5's `dereferenceBoost`) still has no route.
- The Sample label's dialog and the Follow note share `InfoDialog`; the Follow note's text is a
  placeholder until M8/M9.

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
