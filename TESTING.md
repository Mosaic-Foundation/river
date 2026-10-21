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
npx tsx scripts/perf-feed.ts      # check 34's timing, against the dev server (docs/perf/)
```

The dev server for API and e2e runs needs, in `.env`, `FETCH_FIXTURES_DIR=tests/fixtures/http`
and `TEST_CLOCK_NOW=2026-10-21T00:00:00.000Z` (the hub recordings' clock), as CI writes them. The
first `GET /api/feed` resolves and fetches every seed follow from the recordings.

Sign-in (M8) also needs, in `.env`: `RIVER_PUBLIC_ORIGIN` equal to the UI's origin
(`http://localhost:5173` for `npm run test:e2e`, `http://localhost:4173` against `vite preview`,
as CI runs it), `TRUSTED_DID_HOSTS=localhost:3001,localhost:3005` (the identity dev server, and
the DID logs `tests/api/signin.test.ts` serves on :3005; keep :3005 and :3006 free) and
`TEST_DID_LOOPBACK=1`, which lets the River read those logs over loopback http. A
`SESSION_SECRET` of at least 32 characters (`openssl rand -hex 32`).

The identity host (`npm run dev:identity`) needs `.env.identity` as CI writes it:
`EMAIL_TRANSPORT=capture`, `TEST_ROUTES=1` (the capture mailbox, the identity clock and the
rate-limit reset under `/test/`) and a throwaway recovery key pair made outside the repo:

```bash
openssl genpkey -algorithm ed25519 -out /tmp/recovery-test.pem      # never inside the checkout
npx tsx scripts/recover-dids.ts --print-public-key --key-file /tmp/recovery-test.pem
# put that z6Mk… value in .env.identity as IDENTITY_RECOVERY_PUBLIC_KEY, then:
TEST_RECOVERY_KEY_FILE=/tmp/recovery-test.pem npm run test:e2e
```

Check 37's e2e test fails with that instruction when `TEST_RECOVERY_KEY_FILE` is unset. Its
`recover-dids` subprocess reads `.env.identity` when the file exists, and otherwise the identity
settings in the Playwright process's own environment. The
database tests make their own recovery key pair at test time. Never commit a private key, and
never use a real recovery key in tests. didwebvh-ts writes each DID log it creates to
`./test/logs/` when `NODE_ENV=test` (Vitest); the folder is gitignored.

**Synthetic fixtures (M12).** The PeerTube channel and the podcast feed the M12 tests follow are
SYNTHETIC, not recorded: `tests/fixtures/http/synthetic-tube.example/` and
`synthetic-podcast.example/`, written by `scripts/synthetic-media-fixtures.ts` to the published
formats (PeerTube's ActivityPub Video object, RSS 2.0 with Apple's podcast namespace) on reserved
`.example` hosts, because the thread that built M12 could not reach any real PeerTube or podcast
host. Each file carries a `note` saying so; `tests/fixtures/http/README.md` has the details.
Tests that use them say SYNTHETIC in their header. Replace them with recordings once real sources
are chosen (`npm run record-fixtures -- --media <address>`).

## Log

Newest first: date, slice, tests added, counts.

- 2026-10-21, M12 (stretch, real media): unit `rssFeed` (the XML reader: CDATA, entities, numeric
  references, canonical namespace prefixes, entity declarations refused, sloppy markup survived,
  runaway nesting refused; `itunes:duration` in seconds, MM:SS and HH:MM:SS and what it rejects;
  RSS 2.0 podcast items to `podcast` with duration and image, enclosure type by extension, http
  media dropped, the media file as URL when there is no link, permalink guids; hostile HTML
  sanitized; author emails never kept, in the item or its raw copy; Media RSS video with
  thumbnail; article vs post; undated items; hashed ids; the entry cap; RSS 1.0; Atom with html
  and xhtml content and enclosures; non-feeds and a truncated feed; autodiscovery and page
  detection), `mediaAdapters` (SYNTHETIC fixtures through the real guard: the PeerTube channel by
  handle and URL, its videos with title, duration, thumbnail and watch page, HLS-only files,
  stop-at-known, another channel's video and an unreadable one kept as boost cards, the 20-video
  cap, no dereference outside PeerTube; the podcast by feed URL and by home page, episodes newest
  first in the 90-day window, ETag and 304, undated episodes keep their first time, the F6 error
  sentences, refused private addresses), `fediverseMap` (+2: a PeerTube Video's PT4M33S, widest
  icon, HLS file and Markdown as text; a duration without a file), `adapterRegistry` (the feed
  adapter last; which adapters take which inputs), `followResolve` (+kind labels). API `media`
  (dev server, a member signed in through the real callback): previews of the feed URL, the
  podcast's home page, the channel's URL and handle; following each into its own circle shows
  the episodes as podcasts with durations and the videos with durations and thumbnails; the
  Podcasts and Videos filters; the Following page's kind. e2e `media`: a member follows the
  podcast by its home page and the channel by handle from the follow box; the cards show kind,
  length ("42 min", "4:33") and "Open on {host}" (new tab, noopener); the thumbnail that can't
  load is gone; axe clean. Unit 516, API 141 (fresh `db reset`), e2e 48 (fresh `db reset`).
  The run passed the identity host's settings to Playwright's environment for check 37 (no
  `.env.identity` in the worktree), as M11 describes.

- 2026-10-21, M11: unit `riverExport` (spec 3.3's document: exactly its keys, format and version;
  follows with stream keys, rules and circle names in circle order; circles with color and role;
  preferences without `seed_pending`; pending seeds exported as follows, deduplicated; a foreign
  circle id ignored; null DID; nothing email- or key-shaped) and `liveTests` (the @live wiring:
  default Vitest includes only unit and api, Playwright only e2e, only `test:live` uses the live
  config, no workflow runs it, every live test named `@live`). API `export` (dev server, members
  signed in through the real callback with `tests/api/helpers/member.ts`): check 29 (visitor and
  forged cookie 401; the member's document, headers, DID, seed circles and follows; a new circle,
  a circle membership, a muted stream and an unfollow show up; another member sees only their
  own). e2e `export`: check 29 through a real passkey sign-up (the download's file name and JSON,
  a circle added from the page shows in a fetched export, the sign-up address appears nowhere, a
  visitor gets 401). `@live` `seeds.live.test.ts` (check 32: the three hubs and @w3c@w3c.social
  through the adapters and the production guard) typechecks and lints; not run by this thread
  (real hosts). Its logic was dry-run once against the recordings in a throwaway copy. Perf script
  `scripts/perf-feed.ts` (check 34; numbers in `docs/perf/feed-report.md`). Check 37's
  `recover-dids` subprocess now reads `.env.identity` only if present. Unit 452, API 136 (fresh
  `db reset`), e2e 47 (fresh `db reset`).

- 2026-10-21, M10: unit `plugins` (the manifest: the spec's shape on every River surface, frozen;
  refuses another kind, unknown surface or capability, bad id or version, extra fields; the
  registry: three v1 plugins, repeats refused, every plugin a mode places exists and declares that
  surface, an instance can turn one off; `runSurface`: items only with `read:items`, frozen copies,
  nothing but `items` and `now`, a throwing or meddling plugin left out; Coming up: date order,
  five at most, past and bad dates out, start times only for events, one entry per process, title
  fallback; the placeholders' sources; modes: definitions, order, check 8's parse, the civic circle
  by role and not by name), `ui/modes` (switch shown for two or more modes, `?mode=` in links and
  the feed query, the Following page's theme, panel words), `lintBoundaries` (a plugin imports only
  its ViewApi; no fetch, process, globalThis, require). Database `modes` (river_app, own member and
  hub spaces reading the recorded Longmont and Demosville feeds): check 7 for a member (Civic
  shows the civic hub plus the space in the circle whose role is civic, "Our town", and not the
  one in a circle merely named "Civic"; Coming up has the recorded 2026-11-08 deadline once, in
  date order; the slots follow; later pages carry no surfaces), Coming up reads the view (posts or
  an unmatched search: no dates, slots stay), Mark all read in Civic marks only that view; check 8
  (an instance inserted as postgres with modes_enabled = [civic] opens in Civic with the panel and
  refuses Everything; `instances.plugins` turns Coming up off). API `modes` (dev server): the seed
  instance's modes and themes, the Civic panel over HTTP, the panel follows filters and the first
  page, `bad_mode`; check 8 by Host header on a civic-only instance inserted as postgres. e2e
  `modes`: check 7 as a visitor (switch, Civic theme tokens, panel with Coming up in date order and
  the recorded deadline, only civic-category cards, no samples, axe, panel beside the feed, reload
  keeps the mode, back to Everything), on a phone (picker in the header, panel above the feed, no
  sideways scroll, tabs and filters, axe), as a member (rename Civic to "Our town" and add the
  campaign sample on the Following page, which wears the Civic theme; Civic mode then shows it;
  circle filter in Civic), and check 8 on `civic-only-*.localhost` (no switch on desktop or phone,
  opens in Civic with the panel, `?mode=everything` falls back to Civic, axe). The recordings hold
  one voting_closes_at, so date order across several dates is proved in the unit tests. Ran
  against the dev servers and against `vite preview` on 4173. Unit 437, API 132 (fresh `db
  reset`), e2e 46.

- 2026-10-21, M9: unit `followResolve` (the follow box's resolve through recorded fixtures: check
  13 preview, 14 stream key validated with probeStream, 15 preview with avatar and kind, the hub →
  fediverse fallback on a DERIVED 404 civic.json, check 16 refusals with zero requests, not a
  Space, unreachable, a DERIVED 401 actor on a non-Mastodon server = server-only; kind and address
  labels); `feedScope` gains the member rules (a mute hides only inside a followed space; a
  circle that drops the space drops its mutes). Database `following` (river_app; own member and
  own hub spaces reading the recorded Floyd and Longmont feeds): check 18 end to end (stream
  follow → refresh → End, Aggregation, Result; the Result is the only final result; the follow
  moves to Ended and leaves Spaces; ended items still show; daily job +120 days rolled back keeps
  only the Result and clears the follow); following an already-ended stream goes straight to
  Ended; check 17 (mute hides exactly that stream's items, unmute restores them); check 14's feed
  half (only the Longmont meeting stream, then the whole space, then unfollow); a cross-space
  stream rule refused by the FK; check 19 (quiet: old and never-dated hub/fediverse spaces; not a
  recent one, not a never-fetched one, never a sample; unfollow all quiet; circles emptied); circle
  create/rename/recolor/delete, names unique, civic role kept and undeletable, only followed spaces
  in circles; check 27 for the new writes (another member's rule, circle and circle ids are
  unreachable). API `following` (dev server, a DID log on :3005 like `signin`): visitors 401 and
  foreign/missing Origin 403 on every route; check 13 and 15 over HTTP (unfollow the seed, preview,
  follow, items come back; w3c with boost cards, narrowed by a new circle); F6 sentences for both
  preview and follow; circles over HTTP. e2e `following`: checks 13, 14 + 17, 18 (with the retention
  run), 19 (spaces made as postgres for the member), circles (create, recolor, rename, members,
  River filter, Civic undeletable and renamable, delete), and 15 on a phone (the visitor's sign-up
  prompt, header Follow → Following tab, preview avatar URL, boosts shown, hidden replies never
  in the feed, Circles tab), with axe on the Following page, preview, Ended tab and phone tabs
  (check 31). Ran against the dev servers and against `vite preview` on 4173. Unit 401, API 122
  (fresh `db reset`), e2e 42.

- 2026-10-21, M8: unit `riverSignIn` (check 11 with test keys and didwebvh-ts logs: every
  refusal by its reason, wrong aud, expired exp, iat ahead, nonce, alg none/ES256/eddsa, iss ≠ sub,
  kid of another DID or not `{did}#…`, a kid the document doesn't list, a different key even with
  a key in the header, a tampered payload, an untrusted host with zero requests, unknown and used
  state, missing or different state cookie without spending the attempt, malformed notes, a log
  that doesn't verify; leeway edges; the 10-minute cache; recover-dids re-key verified through a
  fresh read; DID parsing; production resolution through the guard with a MockAgent; loopback
  refused without the flag and for any non-loopback URL; signed cookies and sessions). Mutation
  check: dropping the alg, trusted-host, state-cookie, nonce, aud or kid-prefix check each fails
  tests. API `signin` (dev server; a DID log server on :3005 and an untrusted one on :3006): the
  start redirect and cookie, a good note (303 to `/`, 30-day HttpOnly Secure Lax cookie,
  no-referrer, one account, the session works, the state is spent), check 11's eight note cases
  plus untrusted host (no request), unknown and used state, missing, different or forged state
  cookie (attempt kept), an attempt older than 10 minutes — all 401, no session, no account;
  Origin refusals, tampered session, sign-out; member read state (mark, unmark, bad ids, Mark all
  read for one circle only; visitors 401). `feed` (visitors can't write read state). Database:
  `isolation` adds real sign-ups through `signInAccount()` (seeds copied, members isolated, same
  account by SCID, login methods invisible and immovable, auth_attempts insert-only and consumed
  once per instance), `catalog` (the two sign-in functions), `dailyJob` (stale auth_attempts
  deleted). e2e `signin` (check 10 through the River's Sign up: login method, SCID, seed follows,
  default circles with Civic's role, cookie flags, member circles by id, sign-in again finds the
  account; check 23 member: Mark read, opened link, Mark unread, Mark all read, each after reload,
  nothing in localStorage; sign-out; phone You tab with axe; a stray callback gets the 401 page).
  `identity` now starts every flow at `/api/auth/signin` and finishes at the real callback
  (`catchCallback` is gone); checks 36 and 37 prove the same River account after recovery and
  after `recover-dids`. Unit `env`, `lintBoundaries` (constraint 7), `ui/csp` (no-referrer rule),
  `ui/viewer`. Ran against the dev servers and against `vite preview` on 4173. Unit 388, API 109
  (fresh `db reset`), e2e 36.

- 2026-10-21, M7: e2e `identity` with Chromium's virtual WebAuthn authenticator (CDP
  `WebAuthn.addVirtualAuthenticator`, ctap2, internal, resident keys, user verification): checks
  9 (sign-up makes a resident credential, a person and a DID; did.jsonl is `text/jsonl`, verifies
  with didwebvh-ts's `resolveDIDFromLog`, first entry `did:webvh:1.0` and `portable: true`; the
  note verifies against `#key-1`; the same passkey signs in again), 12 (seven inexact
  `redirect_uri`/`client_id` variants get 400 and no redirect; an assertion over request A's
  challenge is refused for B, then accepted for A; B stays unused), 28 (stored ciphertext and
  wrapped key hold no PKCS#8 header and parse as no private key; no identity response carries
  key material), 35 (invalid addresses refused, the link verifies once, a link 24 h + 1 min old
  fails, and a form opened in time but posted late fails), 36 (a new authenticator registers on
  the same DID through the emailed link and finishes the authorize redirect with the original
  state and nonce; same user handle; two passkeys; notice email; unknown address gets the same
  words and no mail; used and 16-minute-old links fail; no `@example.test` address in any river
  table), 37 (two update keys, the second the run's recovery key; `recover-dids` as a subprocess
  appends version 2 signed by the recovery key; the log verifies, SCID and DID unchanged; the same
  passkey signs in and the note verifies with the new key, not the old), change email, and the
  identity pages under axe, Tab and the CSP. The River's callback is answered in the browser
  (M8 builds it). API `identity` (:3001; exact client matching, WebAuthn options, rate limits,
  same-origin POSTs, uniform recovery answer, gone links, no key material). Database
  `db/identity` (identity_app: catalog, ENABLE + FORCE RLS, identity_app-only policies, column
  grants, no DELETE; per-person and per-request isolation; append-only did_log; lookups; person
  creation; recover-dids with a key pair made at test time; river_app denied every identity table
  and function). `db/dailyJob` now deletes stale `identity.auth_requests`. Unit `identityKeys`,
  `identityDid`, `identityNote`, `identityHost`; `dbContext` (forIdentity scopes). Unit 344,
  API 84, e2e 31.

- 2026-10-21, M6: e2e `river` (checks 3, 4, 21, 26 UI part, 30, 31, plus filters and the API's
  empty-state text, search, Load more from the keyboard, boost wording, avatar fallback, the CSP
  header with no violations, and visitor read state: Mark read, opening a link, reload, Mark all
  read, only `GET /api/feed` requests). `tests/e2e/fixtures.ts` is an auto fixture every spec now
  imports: the browser context reaches loopback hosts only and every other request is aborted and
  recorded; a test fails if anything but an image (or a new tab's page) was attempted off-origin.
  Check 26 loads `http://unknown.localhost:<port>/` through the real proxy and API. Check 21
  fails one sample image with a routed 404 and relies on the blocked live images. Unit
  `ui/format`, `ui/readState`, `ui/csp` (vercel.json's policy). `smoke` and `themes` updated
  for the feed page (themes ignores image requests, which the fixture blocks). Mutation check:
  removing the image `onError` fails check 21. Ran against the dev servers and against `vite
  preview` on 4173 (CI's path). Unit 308, API 56 (fresh `db reset`), e2e 22.

- 2026-10-21, M5: API `feed` (dev server; checks 1, 2, 5, 6, 23 visitor part, 26 API part, filters,
  civic mode, 400s, sample event). Database (`tests/api/db/`, river_app): `refresh` (check 24 with
  a request-counting MockAgent, sequential and concurrent; check 20 with fake timers: answered at
  6 s, not 5.999 s, with the fast hub's items, the slow source's note and released claim after its
  fetch fails at 30 s; check 33 with the recorded empty-no-next probe, plus the empty-with-next
  and 7-day cases; refresh window and 304; stream ends moving every account's follows to Ended;
  final result only moves forward; resolving a new followed name; resolve back-off), `host`
  (forHost reads instances only and writes nothing; hostname, alias and preview mapping),
  `dailyJob` (as postgres in a rolled-back transaction: the cron entry; 120 days on, a followed
  stream's final result and samples stay, everything else goes, the ended follow is cleared and
  the result survives the next day; samples re-stamped), `catalog` (samples in seed_follows and
  default_circles; function grants). Unit `feedScope`, `adapterRegistry`, `env`
  (TEST_CLOCK_NOW, VERCEL_ENV), `dbContext` (forHost). E2E `feed` (the feed through the UI's
  proxy; sample images served). Mutation check: removing the budget race fails check 20.
  Unit 290, API 56 (fresh `db reset`), e2e 6.

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
