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

### 2026-10-21 — The export's circles carry no members
- Question: 3.3's `circles` entries hold only `name`, `color` and `role`; a space reaches a circle
  only through a follow's `circles`. A circle can hold a space the member doesn't follow (a seed
  circle member, or a whole-space unfollow that kept a stream rule elsewhere), and that membership
  can't be written in the export.
- Reading used: the spec's shape exactly; memberships of followed spaces travel on the follows,
  others are left out.
- Proposed change: give each circle `members: [url…]` (canonical URLs), and keep `circles` on
  follows as a convenience, or drop it there in a version 2.
- Thread / PR: M11

### 2026-10-21 — Ended stream rules in the export
- Question: 3.3 has no field for a stream rule whose process has ended (Ended on the Following
  page, cleared after 90 days). Exported as a plain follow it would be re-imported as an open one.
- Reading used: ended rules are left out of `follows`; they no longer change the feed.
- Proposed change: an optional `ended_at` on follows if Ended should travel with the member.
- Thread / PR: M11

### 2026-10-21 — "20 follows" with 16 recorded sources (check 34)
- Question: check 34 asks for `GET /api/feed` with 20 follows, but the recordings hold 9 real
  sources and the seed adds 7 samples: 16 spaces. Recording more would contact real hosts.
- Reading used: 20 follow rows: the 16 seed follows plus 4 "just this stream" follows of open hub
  processes (counted through the export). The report says so.
- Proposed change: "20 followed spaces or streams", or record extra hubs when Adam allows a
  `record-fixtures` run.
- Thread / PR: M11

### 2026-10-21 — What "renders" means in a Vitest @live test (check 32)
- Question: check 32 says each live hub "renders at least one item", but `@live` tests run through
  Vitest (spec 6: `npm run test:live`), which has no browser, and a browser run against live hosts
  would need a dev server without fixtures and its own database.
- Reading used: each source is resolved and fetched through its adapter and the production fetch
  guard; "renders" means at least one item a feed card can draw (shown, a kind label, a valid
  relative time, text or media, an https "Open on {host}" link), checked with the UI's own
  `ui/src/lib/format.ts` helpers.
- Proposed change: say "yields at least one displayable item", or add a Playwright `@live` project
  if a full browser run is wanted.
- Thread / PR: M11

### 2026-10-21 — instances.theme next to the modes' themes
- Question: 3.1 gives instances a `theme` (mosaic, civic), while 4.7 gives each mode its theme
  (Everything is Mosaic, Civic is Civic) and check 26 says the seed instance gets the Mosaic theme.
  When they differ, which wins?
- Reading used: the mode's theme, always; `instances.theme` is returned in the feed's `instance`
  block and otherwise unused. The civic-only test instance sets both to civic.
- Proposed change: 3.1 says `instances.theme` is the theme for pages outside any mode (or drop it
  until modes can name their own theme per instance).
- Thread / PR: M10

### 2026-10-21 — "The current items" for Coming up
- Question: 4.7 says Coming up takes dates "from the current items"; the feed loads 30 at a time,
  so the dates could be those of the loaded cards or of the whole view.
- Reading used: the whole current view (mode, circle, type, search), newest 500 items, read on the
  server with the River's clock. A vote opened weeks ago still shows its closing date.
- Proposed change: 4.7 says "the current view's items".
- Thread / PR: M10

### 2026-10-21 — Plugins that read nothing
- Question: 4.7's manifest shows `capabilities: ["read:items"]`; the placeholder slots read no item.
- Reading used: the placeholders declare `capabilities: []` and receive no items (declare what you
  need). The manifest still allows only `read:items` in v1.
- Proposed change: 4.7 says capabilities may be empty.
- Thread / PR: M10

### 2026-10-21 — A stream-only follow's final result after 90 days
- Question: F7 clears Ended follows 90 days after the stream ends, and retention keeps the final
  result for good; but once the stream-only follow is gone, the member's River no longer includes
  that stream, so the kept result shows only to those following the whole space.
- Reading used: as written (the follow is deleted; the result stays stored). The mockup's "their
  final results stay in your River" holds for the 90 days the follow is under Ended.
- Proposed change: spec F7 says whether a cleared Ended follow should leave a "final result only"
  rule behind.
- Thread / PR: M9

### 2026-10-21 — TRUSTED_DID_HOSTS names a host with its port
- Question: spec 4.6 and Appendix D say "DIDs whose host is in TRUSTED_DID_HOSTS (v1:
  id.mosaic.social)", and CI wrote `localhost`, but a local DID's host component is
  `localhost%3A3001` (did:webvh puts the port in the host).
- Reading used: an entry matches the DID's decoded host exactly, port included
  (`localhost:3001`); an entry without a port matches only a DID without one. Local and CI:
  `TRUSTED_DID_HOSTS=localhost:3001,localhost:3005` (the identity dev server, and the DID logs the
  API tests serve). Production is unchanged: `id.mosaic.social`.
- Proposed change: Appendix D says "host[:port], as in the DID; locally localhost:3001".
- Thread / PR: M8 (claude/m8-sign-in)

### 2026-10-21 — What "kid starts with that DID" allows
- Question: spec 4.6 step 4 requires `kid` to start with the DID, which `{did}x#key-1` (another
  DID's text) also does, and doesn't say which of the document's keys verifies.
- Reading used: `kid` must be `{did}#` plus a non-empty fragment, and the key is the Ed25519
  Multikey of the verification method with exactly that id listed under the resolved document's
  `authentication` (relative `#key-1` ids read against the DID). Anything else is refused. The
  note's lifetime (`exp − iat`) is capped at 10 minutes as well; the identity host issues 120 s.
- Proposed change: spec 4.6 says "kid is `{did}#fragment` and names an `authentication` method".
- Thread / PR: M8

### 2026-10-21 — "Mark all read for the current view" for members
- Question: F4 says "Mark all read for the current view"; M6 read that as the items loaded on the
  page (visitors keep only what they have seen, in the browser).
- Reading used: for a member it is the whole view on the server (same mode, circle, type and
  search as the feed), newest first, up to 5,000 items; items arriving later stay unread.
  Visitors keep M6's loaded-items behavior.
- Thread / PR: M8

### 2026-10-21 — "Final results of streams any account followed" outlives the follow
- Question: spec 3.1 keeps "is_final_result items of streams any account followed", and F7 clears
  Ended follows 90 days after their stream ends, about when the final result turns 90 days old.
  Read as "a follow row exists now", the result would be deleted soon after its follow.
- Reading used: the daily job marks `streams.keep_final_result` on every stream an account follows
  (the stream, or its whole space, rule follow) before retention runs, and never clears it. A
  stream counts as followed once and for good. Muted streams and visitors' seed follows don't count.
- Proposed change: spec 3.1 adds `streams.keep_final_result` and says "ever followed".
- Thread / PR: M5 (claude/m5-feed-api)

### 2026-10-21 — auth_requests has no created_at
- Question: spec 4.5 deletes "auth_attempts and auth_requests older than 1 day", but 3.2 gives
  auth_requests no `created_at` (only `expires_at`, 10 minutes after creation).
- Reading used: the job deletes `identity.auth_requests` whose `expires_at` is more than a day ago,
  and `river.auth_attempts` by `created_at` (3.1 has it). Both only when the table exists
  (`to_regclass`), so M7 and M8 must keep those column names or change the job.
- Thread / PR: M5

### 2026-10-21 — A withdrawn stream's items are hidden, the stream itself unchanged
- Question: 4.2 says to hide a withdrawn process's items; it doesn't say what happens to the
  stream or its follows.
- Reading used: items get `hidden = true`; the stream keeps its status and its follows, so a
  member who followed it sees an empty stream, not an Ended one. If the hub serves the process
  again, a later fetch that includes those items stores them visible again.
- Thread / PR: M5

### 2026-10-21 — mastodon.social refuses the actor, not the outbox
- Question: spec 4.3 gives the 401/403 fallback only for the outbox read, but mastodon.social
  (two seed accounts) answers unsigned actor reads with 401 while serving outboxes with 200.
- Reading used: resolve falls back to `/api/v1/accounts/lookup` for the profile when NodeInfo says
  Mastodon; the ActivityPub outbox is still read normally.
- Proposed change: spec 4.3 says "When the actor or outbox read returns 401/403 …".
- Thread / PR: M4 (claude/m4-fediverse-adapter)

### 2026-10-21 — Self-replies in a thread
- Question: "Replies are hidden" doesn't say whether an account's replies to its own posts count.
- Reading used: hidden too (the conservative reading).
- Thread / PR: M4
### 2026-10-21 — An empty limit=1 page doesn't mean a stream is gone
- Question: spec 4.2 validates a stream (and detects a withdrawn one, check 33) with
  `?context={key}&limit=1`, treating an empty page as gone. Recorded Longmont streams answer
  `orderedItems: []` with a `next` (the hub filters non-public events after the limit), while a
  process the hub doesn't serve answers empty with no `next` (recorded on all three hubs).
- Reading used: `probeStream()` returns `exists = items.length > 0 || next present`; resolve
  refuses only when it is false. M5's withdrawn check must use `exists`, not the item count.
- Proposed change: spec 4.2 says "empty and no `next`".
- Thread / PR: M3 (claude/m3-civic-hub-adapter)

### 2026-10-21 — Process ids aren't always hex
- Question: spec 4.2 says `proc_[0-9a-f]+`, but Floyd serves `proc_beta_vote_energy_001`.
- Reading used: accept `proc_[a-z0-9_]{1,64}`; the key is validated against the hub before use.
- Proposed change: spec 4.2 says `proc_[a-z0-9_]+`.
- Thread / PR: M3

### 2026-10-21 — Where voting_closes_at lives
- Question: spec 4.2 names `hub:payload.voting_closes_at`; recorded civic:Start activities nest it
  at `hub:payload.process.voting_closes_at`.
- Reading used: read either.
- Proposed change: spec 4.2 names `hub:payload.process.voting_closes_at`.
- Thread / PR: M3

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
- Resolved (Adam, 2026-10-20): approved. `forHost()` may read `river.instances` and nothing else.
  The M6 PR amends CLAUDE.md constraint 2 to name it (that PR is `needs-adam`).
- Done in M5 instead (2026-10-21): the feed resolves the instance from the hostname, so M5 adds
  `forHost()` and carries the CLAUDE.md amendment; that PR is `needs-adam`.
- Thread / PR: M1 (claude/vibrant-keller-6qnr0g), M5 (claude/m5-feed-api)

### 2026-10-20 — Shared tables still need an instance setting
- Question: spec 3 says shared tables (`spaces`, `streams`, public `items`) "allow read to
  river_app regardless of account". Read literally, a query outside any wrapper could read them.
- Reading used: regardless of account, but not regardless of context: their policies require
  `app.instance_id` to be set. A query that skips forInstance()/forAccount() sees no rows at all,
  which makes a missed wrapper show up in tests instead of silently working.
- Proposed change: spec 3 adds "inside an instance context".
- Resolved (Adam, 2026-10-20): agreed; keep requiring `app.instance_id` on shared tables.
- Thread / PR: M1

### 2026-10-21 — Sign-up says when an address already has a Mosaic ID
- Question: spec 4.6 makes "Lost your passkey?" answer the same for every address so the page
  doesn't reveal who has an account, but sign-up needs a unique address and the account must work
  before the link is clicked. Any sign-up that fails for a taken address reveals it.
- Reading used: sign-up checks the address before the passkey is created and says "That address
  already has a Mosaic ID. Sign in with your passkey, or use “Lost your passkey?”." (409), so no
  orphan passkey is left on the device. Sign-up is rate-limited per IP (10 an hour). The recovery
  page itself reveals nothing.
- Proposed change: spec 4.6 says sign-up may reveal that an address is taken, or moves to
  verify-before-create (which the "works before the link is clicked" rule rules out today).
- Thread / PR: M7 (claude/m7-identity-host)

### 2026-10-20 — Which settings forIdentity() sets
- Question: CLAUDE.md says forInstance(), forAccount() and forIdentity() all set `app.instance_id`
  and `app.account_id`, but identity tables (spec 3.2) have no instance or River account.
- Reading used: M0's forIdentity() opens a transaction and sets nothing; M7 picks the setting its
  policies read (likely the person's id) when it creates the identity schema.
- Proposed change: CLAUDE.md constraint 2 names the settings per helper.
- Resolved (M7, 2026-10-21): `forIdentity({ personId?, authRequestId? })` sets `app.person_id` and
  `app.auth_request_id` (see the M7 log entry "forIdentity() settings and the lookups"). CLAUDE.md
  constraint 2 still names only the River's two settings; the proposed wording stands: "forIdentity()
  sets app.person_id and app.auth_request_id".
- Thread / PR: M0 (claude/mosaic-river-v1-m0-8dyv4n), M7 (claude/m7-identity-host)

## Log

## 2026-10-21 — Several content types and networks in /api/feed (UI revisions 1, items 2 and 4)
- Decision: `type` takes a comma-separated list (`type=posts,videos`); a new `network` parameter
  takes `hubs` (adapter `civic_hub`) and/or `fediverse`. Empty means all. Unknown values are 400
  (`bad_type`, `bad_network`). "Mark all read" takes the same fields. Sample entries belong to no
  network, so any network filter hides them.
- Why: the filters are AND across groups and OR inside one (item 2: none selected means All);
  samples stand for clubs, families and podcasts, not hubs or the fediverse.
- Alternatives: repeated `type=` parameters (refused before, kept refused); filtering on the
  client (breaks paging and "Mark all read").
- Thread / PR: UI revisions 1, PR 2

## 2026-10-21 — The export's shape and route (M11)
- Decision: `GET /api/me/export` (members; visitors 401 `sign_in_required`) returns spec 3.3's
  seven keys and nothing else, with `Content-Disposition: attachment;
  filename="mosaic-river-export.json"` and `Cache-Control: no-store`. `did` is the DID the member
  last signed in with (login_methods by `last_used_at`; null if none). `follows`: one entry per
  active rule (whole-space follow, stream follow, stream mute), oldest first; `url` is the space's
  canonical URL (hub origin, fediverse actor id, sample URN), `stream_key` the process URL, `circles`
  the names of the member's circles holding the space, in circle order. Seeds still waiting for
  their space (`seed_pending`) are exported as the follows they will become; that internal
  preference itself is not exported, the rest of `preferences` is key → value. `exported_at` is the
  real clock, not the adapters' test clock. Reads run in one forAccount() transaction
  (`src/river/export/`), so RLS limits them to the member (check 27). The River holds no email
  address or key, so the export has none.
- Why: spec 3.3, check 29, constraint 7; the M9 follow-up (stream rule = space URL + stream key).
- Alternatives: reusing `followingPage()` (shaped for the page, with UI fields and the known-streams
  query the export doesn't need); including ended rules (spec question).
- Thread / PR: M11

## 2026-10-21 — @live tests go through the adapters, not the browser (M11)
- Decision: `tests/live/seeds.live.test.ts` resolves and fetches Demosville, Floyd, Longmont and
  `@w3c@w3c.social` with the River's adapters through `createFetchGuard()` (real DNS, every
  address checked, no fixtures). No database, `.env` or server needed. `tests/unit/liveTests.test.ts`
  proves the wiring: the default Vitest config includes only tests/unit and tests/api, Playwright
  only tests/e2e, only `test:live` names the live config, no workflow runs it, and every live test
  is named `@live` in a `*.live.test.ts` file.
- Why: spec 6 (only through `npm run test:live`, never in CI), check 32; vitest.live.config.ts
  from M0.
- Alternatives: a Playwright `@live` project (needs a fixture-free server and database).
- Thread / PR: M11

## 2026-10-21 — The perf script is a script, not a gate (M11)
- Decision: `scripts/perf-feed.ts` (`npx tsx scripts/perf-feed.ts`) signs a member in through the
  real callback (the shared `tests/api/helpers/member.ts`), adds 4 stream follows to the 16 seed
  follows, and times 100 sequential warm requests per row; it refuses a non-loopback API URL.
  Results in `docs/perf/feed-report.md`. No npm script, so CLAUDE.md's Commands stay as they are.
- Why: check 34 ("manual, not a gate"); recorded fixtures only.
- Alternatives: a Vitest benchmark in tests/api (would run with every `test:api`).
- Thread / PR: M11

## 2026-10-21 — API sign-in helper shared from tests/api/helpers/ (M11)
- Decision: `tests/api/helpers/member.ts` (a DID log server on :3005 and `signIn()`) is used by
  the export test and the perf script. The older copies in `signin.test.ts` and
  `following.test.ts` are left as they are.
- Why: one more copy would have been the third; changing the existing files isn't M11's scope.
- Thread / PR: M11

## 2026-10-21 — Check 37's recover-dids run reads .env.identity only if present (M11)
- Decision: the e2e test spawns `tsx --env-file-if-exists=.env.identity scripts/recover-dids.ts`,
  so a run can pass the identity settings through the environment (a worktree without `.env`
  files). CI writes `.env.identity`, so nothing changes there.
- Why: `--env-file` fails outright when the file is missing; `npm run recover-dids` already uses
  `--env-file-if-exists`.
- Thread / PR: M11

## 2026-10-21 — Modes are code definitions; the mode lives in the URL (M10)
- Decision: `src/river/modes/` defines Everything (`scope: all`, Mosaic, no surfaces) and Civic
  (`scope: civic`, Civic theme, `river.panel`: Coming up, Your representatives, Elections and
  ballot). `instances.modes_enabled` picks and orders them; `default_mode` opens first. Civic's
  scope is civic-category spaces plus the reader's circle with `role = civic`, found by role (a
  renamed civic circle still counts; a circle merely named "Civic" doesn't). The feed answers
  `modes: [{id, title}]` (the switch shows when there are two or more), `theme` (the mode's) and
  `surfaces`. The UI keeps the mode in `?mode=` (left out for the default; a mode the instance
  doesn't offer opens the default, `bad_mode`). Links to `/following` carry `?mode=` when it isn't
  Everything, so that page wears the mode's theme and links back to it. A member's mode is not
  saved as a preference.
- Why: spec F9, 3.1 ("built-in definitions in code plus `instances.modes_enabled`"), 4.7; decisions
  log row 23; the M9 follow-up (find the civic circle by role).
- Alternatives: a `mode` preference for members (spec doesn't ask; the URL serves visitors too);
  separate stylesheets per mode (DECISIONS M0: one attribute switch).
- Thread / PR: M10

## 2026-10-21 — Plugins run in-process on the server and return data (M10)
- Decision: a first-party plugin is `{ manifest, render(api) }` in `src/river/plugins/builtin/`,
  bundled with the server. The registry checks each manifest at load (`kind: "view"`, surfaces
  from `river.panel | river.mode-header | river.card-action`, capabilities from `read:items`, a
  `1.0.0` version, no unknown fields) and refuses repeats. On the feed's first page the River runs
  the plugins the mode places, in order, with a frozen `ViewApi { items, now }`: the current
  view's items (same mode, circle, type and search as the feed, newest 500, card fields only: no
  raw activity, read state or reader) and the River's clock. A plugin without `read:items` gets
  no items. It returns data (`dates` or `placeholder`), never markup; the UI draws each type with
  its own component. One that throws is left out and logged by id. Lint lets a built-in plugin
  import only `../api.js` and use no `fetch`, `process`, `globalThis` or `require`.
- Why: spec 4.7 ("read-only access to the current view's items through a typed API and nothing
  else"; first-party, bundled at build time; no sandboxing in v1). Running on the server gives
  plugins the whole view, not only the 30 loaded cards, and the River's clock (TEST_CLOCK_NOW in
  tests), and keeps them away from the page's session, network and DOM.
- Alternatives: plugins as React components in the UI bundle (they'd see only loaded items and the
  browser clock, and could call `fetch` with the member's cookie); a separate `/api/panel` request.
- Thread / PR: M10

## 2026-10-21 — Coming up and the placeholders (M10)
- Decision: Coming up lists `civic.deadline` (voting_closes_at) and event start times at or after
  the River's clock, soonest first, at most 5; one entry per (stream, kind, date), from the newest
  item (a hub repeats a deadline on Create and civic:Start); titled by the item's title (else the
  stream's, else the space's name); linked to the item's URL for live items. Hidden when there are
  none. The two placeholders are plugins too, `capabilities: []`, naming their sources: "Waiting
  on a data source (Open States, Geocodio or Cicero)." and "(Democracy Works or Ballotpedia)." The
  panel is a third column from 80rem, above the feed from 56rem to 80rem and on phones (Feed tab).
- Why: spec F9, 4.7; the civic mockup.
- Thread / PR: M10

## 2026-10-21 — instances.plugins turns plugins off (M10)
- Decision: `instances.plugins` lists changes to the defaults: `[{ "id": "coming-up", "enabled":
  false }]` turns one plugin off for that instance. Empty (the seed instance, unchanged) runs
  every plugin its modes place. Other entries are ignored. No migration.
- Why: spec 3.1 names the column without a shape; decisions log row 25 (instances hold plugins as
  data). Placement stays with the modes (row 23).
- Alternatives: a full list of enabled ids (the seed row would need a data migration).
- Thread / PR: M10

## 2026-10-21 — Civic muted text is #526366 (M10)
- Decision: civic.css `--color-text-muted` goes from `#5a6b6e` to `#526366`.
- Why: Civic mode is the first page wearing civic.css; axe (check 31) found `#5a6b6e` on the page
  background (cream-sink `#e8e2d4`) at 4.3:1. `#526366` is 4.9:1 there and 6.3:1 on white.
- Thread / PR: M10

## 2026-10-21 — Following API (M9)
- Decision: members-only routes under `/api` (src/river/following/routes.ts), each running in
  `forAccount()` after the Origin check: `POST /follow/preview {input}` (resolves, stores nothing;
  a POST so another page can't make the River fetch addresses), `POST /follows {input, scope:
  space|stream, circleIds}` (resolves again, stores the space with `upsertSpace`, the rule and
  circle memberships, then `refreshSpaces()` within the 6 s budget, as the feed does), `GET
  /following` (Spaces, Quiet ids, Ended, circles), `DELETE /following/spaces/:id`, `PUT
  /following/streams/:id {rule}`, `DELETE /following/rules/:id`, `POST /following/quiet/unfollow`,
  and circles (`POST /circles`, `PATCH/DELETE /circles/:id`, `PUT/DELETE
  /circles/:id/spaces/:spaceId`). Resolve failures answer 422 `{error: reason, message}` with
  exactly the F6 sentence (`ADAPTER_MESSAGES`), never the adapter's detail. Visitors 401.
- Why: spec F6–F8; Appendix B (Origin); constraint 2.
- Thread / PR: M9 (claude/m9-following)

## 2026-10-21 — Stream rules and the most specific rule (M9)
- Decision: rows in `river.follows`: (space, no stream, follow) = whole space; (space, stream,
  follow) = just this stream; (space, stream, mute) = muted stream. Both stream rules are made with
  `ends_with_stream = true` ("until the process ends"); a rule on a stream that already ended goes
  straight to Ended (`mark_stream_follows_ended`). One rule per stream (the unique key), so
  muting a followed stream turns it into a mute. A mute hides the stream only inside a followed
  space; a followed stream shows without its space. No whole-space mute (unfollow does that).
  Unfollowing a space deletes its whole-space follow and live stream rules and its circle
  memberships; ended rules stay under Ended. No migration: M1's grants already cover it.
- Why: spec F7 ("most specific rule wins"; mockup labels "Following/Muted, until the process
  ends"), 3.1.
- Thread / PR: M9

## 2026-10-21 — Ended follows in the feed (M9)
- Decision: a stream follow with `ended_at` keeps showing what its stream stored (End,
  Aggregation, Result) until the daily job deletes the follow 90 days on; retention has already
  removed all but the final result by then. An ended mute keeps hiding. Ended lists stream rules
  (follows and mutes) with "Remove"; Spaces never lists them.
- Why: the mockup's note ("Finished streams move to Ended; their final results stay in your
  River"); hiding a stream the moment its result arrives would drop the result itself.
- Alternatives: only the final result after the end (needs a per-item rule in the feed query).
- Thread / PR: M9

## 2026-10-21 — Quiet (M9)
- Decision: a whole-space follow is Quiet when the space is not a sample, has been fetched at
  least once, and `newest_item_at` (null counts as never) is older than 90 days by the River's
  clock (`riverNow()`, so TEST_CLOCK_NOW fixes it in tests, matching the fixtures). Stream-only
  follows are never Quiet. "Unfollow all quiet spaces" unfollows them exactly as Unfollow does.
- Why: spec F7, 3.1 ("Sample spaces are exempt from Quiet"); a never-fetched space has no evidence
  of being quiet.
- Thread / PR: M9

## 2026-10-21 — The civic-role circle stays (M9)
- Decision: the circle with `role = civic` can be renamed and recolored (the role column is never
  written by the app) but not deleted (409 "The Civic circle can't be deleted. You can rename
  it."). Circle names are unique per member (case-insensitive), 1–60 characters; colors `#rrggbb`
  from a palette of eight; at most 50 circles; only followed spaces can be added.
- Why: spec F8/F9: Civic mode reads that circle, and there's no screen to move the role.
- Thread / PR: M9

## 2026-10-21 — The Following page's shape (M9)
- Decision: `/following` (a client route; vercel.json already serves index.html) with the follow
  box and Spaces/Quiet/Ended in the main column and circles beside it, as the mockup. On a phone
  the same parts are the River's Following and Circles tabs; the header's Follow opens the
  Following tab (phone) or `/following#follow` (desktop); members also get a Following link.
  Spaces are grouped by adapter ("Civic Hubs", "Fediverse", "Samples"), each row collapsed; a hub
  row expands to its streams: those with the member's rules first, then up to 25 known streams
  with visible items, newest first, each with Mute / Follow just this. Stream titles fall back to
  the stream's first titled item, then "Process {id}". The preview's kind is "Civic Hub" or
  "{NodeInfo software} account"; the address is the hub's host or the account's handle. Tabs are
  pressed buttons, not ARIA tabs. Visitors get a sign-up prompt in both tabs and on the page.
- Why: spec F6, F7, phone paragraph; mockups/following.png.
- Thread / PR: M9

## 2026-10-21 — seed_pending kept (M9)
- Decision: M8's `seed_pending` preference stays as it is: a seed with no stored space at sign-up
  is copied when its space appears. The follow box doesn't touch it; a pending entry naming a
  deleted circle is skipped (as before).
- Why: it only matters on a River nobody has opened since its seeds changed; folding it into the
  follow flow would add nothing.
- Thread / PR: M9

## 2026-10-21 — Sessions are signed, stateless cookies (M8)
- Decision: the River's session is a cookie `__Host-river-session` holding
  `base64url({v: 1, instance, account, iat, exp}).HMAC-SHA256`, 30 days, HttpOnly, Secure,
  SameSite=Lax, Path=/, host-only. Each purpose (session, sign-in state) signs with its own key
  derived from SESSION_SECRET (at least 32 characters). Every request that reads it checks the MAC
  in constant time, the expiry, that the instance is the request's, and that the account row
  still exists under forAccount(); otherwise the request is a visitor's and the cookie is cleared.
  Sign out (F10, `POST /api/auth/signout`) clears the cookie. A cookie name sent twice is trusted
  neither way. No sessions table.
- Why: spec 3.1 lists no sessions table; the River holds nothing worth a server-side session
  (no tokens, no keys), and a stateless cookie needs no write per request and no cleanup job.
- Trade-off: sign-out ends the session in this browser, but a copied cookie stays valid until it
  expires; rotating SESSION_SECRET signs everyone out. A `river.sessions` table with RLS (revoke on
  sign-out, "sign out everywhere") is the upgrade path if that matters.
- Alternatives: a sessions table (a write per sign-in, a lookup per request, a table and policy to
  review); an encrypted cookie (nothing in it is secret).
- Thread / PR: M8 (claude/m8-sign-in)

## 2026-10-21 — Local DID logs over loopback, without touching the guard (M8)
- Decision: locally and in CI the identity host's DIDs are `did:webvh:…:localhost%3A3001:…` and
  their logs live at `http://localhost:3001/…`, which the fetch guard refuses (https only, loopback
  blocked) and must keep refusing. A new test-only variable, `TEST_DID_LOOPBACK=1` (read through
  env.ts, refused on Vercel like FETCH_FIXTURES_DIR, TEST_ROUTES and TEST_CLOCK_NOW, so a deployment
  with it fails /health), lets the River's DID resolver read a log over http through
  `src/shared/fetch/loopback.ts` only when the DID's host is in TRUSTED_DID_HOSTS AND is
  `localhost`/`127.0.0.1` with a port. That module refuses unless the variable is set, and refuses
  any URL that isn't `http://{localhost|127.0.0.1|[::1]}:{port}/path` without credentials or query;
  it follows no redirect and caps the body like the guard. Every other DID, and every DID in
  production, is read over https through the unchanged guard. The guard itself is not modified;
  the new file sits beside it so undici stays inside `src/shared/fetch/` (ADR-001), which still
  makes this a `needs-adam` change.
- Why: M7's follow-up; Appendix B forbids any private-address override in a production path.
- Alternatives: an option on the guard (touches the guard and its one rule); recorded fixtures
  (the e2e DIDs are made live); serving the identity host over https on a public name locally.
- Thread / PR: M8

## 2026-10-21 — The sign-in callback, step by step (M8)
- Decision: `GET /api/auth/callback` runs spec 4.6 step 4 in this order (src/river/auth/note.ts):
  the signed state cookie equals `state` (constant time; a missing or different cookie spends
  nothing, so it can't burn another tab's sign-in); `river.consume_auth_attempt(state)` marks the
  attempt used and returns its nonce (unknown, used, older than 10 minutes or another instance's:
  refused); the JWS's header says `alg: "EdDSA"` exactly and has no `crit`; `iss == sub`, a
  did:webvh; `kid` is `{did}#fragment`; the DID's host is trusted (before any request); `aud` is
  RIVER_PUBLIC_ORIGIN; `nonce` matches (constant time); `iat ≤ now + 60`, `exp ≥ now − 60`,
  `exp − iat ≤ 600`; then the DID log is read (through the guard; cached 10 minutes per URL),
  verified with didwebvh-ts `resolveDIDFromLog` (our Ed25519 verifier, no witnesses, the DID's
  SCID), and the signature checked with the key the CURRENT document lists under
  `authentication` for `kid`. Keys in the header are never read. When a cached document doesn't
  verify the note, the log is read once more, fresh, so a DID re-keyed by `recover-dids` inside
  the cache window still signs in; the resolved DID must equal `iss` and not be deactivated.
  Success: the account is found or made, a 303 to `/` with the session cookie, the state cookie
  cleared, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. Any failure, including a
  database error, is a 401 HTML page ("Sign-in didn't work", a link home) with no session; the
  log line names the reason code only, never the note, state or cookie.
- Why: spec 4.6 step 4 and check 11; check 37 needs the current document.
- Thread / PR: M8

## 2026-10-21 — login_methods and auth_attempts (M8)
- Decision: migration `20261021180000_sign_in.sql`. `login_methods` is an account table
  (ENABLE + FORCE RLS, own rows only), UNIQUE (instance_id, kind, scid), kind `did` only, river_app
  may SELECT, INSERT and UPDATE only `did` and `last_used_at` (the stored DID follows a move; the
  SCID doesn't change). `auth_attempts` (`state` PK, `instance_id`, `nonce`, `created_at`,
  `used_at`) is an instance table river_app may only INSERT, unused, for its own instance. Two
  SECURITY DEFINER functions (owner postgres, empty search_path, EXECUTE for river_app only),
  scoped to the transaction's `app.instance_id`, each return one value: `account_for_login(kind,
  scid)` (the account, before one is known) and `consume_auth_attempt(state)` (an atomic UPDATE …
  WHERE used_at IS NULL AND created_at > now() − 10 minutes RETURNING nonce). The M5 daily job
  already deletes attempts older than a day by `created_at` (tested). State and nonce are 32
  random bytes, base64url.
- Why: spec 3.1 ("the sign-in callback consumes a row atomically"), ADR-004; the same pattern as
  the identity host's lookups (M7).
- Alternatives: instance-wide SELECT/UPDATE on attempts (every request could read every pending
  nonce); a setting such as `app.auth_state` for a policy (one more setting for one statement).
- Thread / PR: M8

## 2026-10-21 — Accounts and the seed copy (M8)
- Decision: `signInAccount()` (src/river/accounts.ts) looks the SCID up with
  `account_for_login`; a known account gets its login method's `did` and `last_used_at` updated.
  A new one is made in ONE forAccount() transaction with a fresh uuid: the account row, its `did`
  login method, a follow for each seed follow (stream follows included) and the default circles
  in order (`sort` = position, color, `role = civic` for Civic) with their members. Two first
  sign-ins of one DID at once: the second hits the unique key and uses the first's account. A seed
  name whose space isn't stored yet (nobody has opened this River since the instance was seeded) is
  kept in the member's `seed_pending` preference with what it was for (follow, circle ids); the
  member's feed copies it as soon as the space exists and resolves it meanwhile. `display_name`
  stays null: the note carries no name, so the River shows the DID.
- Why: spec F2 ("copies the instance's seed follows and default circles"), check 10; a seed must
  not be lost because its space was never resolved.
- Thread / PR: M8

## 2026-10-21 — A member's feed and read state (M8)
- Decision: `GET /api/feed` with a session reads the member's own rows under forAccount():
  follows with `rule = follow` (stream follows by key; ended follows still show until M9 builds
  Ended), circles by id (`circle=<uuid>`; a name is a 400 `bad_circle`, which the UI answers by
  showing All), the same scopeFor()/queryFeed() as visitors, refresh of every followed space, and
  `read` on each item (an EXISTS on `read_state`, own rows only). The response gains `viewer`
  (`{did, displayName}`, null for visitors); visitor items carry no `read`. `POST
  /api/read-state {read: [ids], unread: [ids]}` (at most 500 each; unknown ids ignored) and `POST
  /api/read-state/all {mode, circle, type, q}` (the whole view, newest 5,000) are members-only (401
  otherwise). The UI marks read optimistically and undoes a change the server refuses; opening a
  link marks read with `keepalive`. Visitors keep localStorage and make no write (check 23).
- Why: spec F4, check 23; M5's hook points.
- Thread / PR: M8

## 2026-10-21 — Sign up and Sign in are one link; Origin on every write (M8)
- Decision: both buttons are links to `GET /api/auth/signin`, which makes the attempt, sets the
  state cookie (`__Host-river-signin`, 10 minutes) and 303s to `{IDENTITY_ORIGIN}/authorize`; the
  identity host's page offers both sign-in and sign-up. A link, not a form POST: the CSP's
  `form-action 'self'` would block a form's redirect to the identity host. Every River request
  but GET/HEAD/OPTIONS must carry `Origin` equal to RIVER_PUBLIC_ORIGIN or gets 403 (Appendix B);
  that includes sign-out and read state. Previews, whose origin differs, can't write, as they
  can't sign in (Appendix D). `vercel.json` adds `Referrer-Policy: no-referrer` for `/api/auth/*`
  after the every-path rule, so Vercel's header can't override the callback's own.
- Why: spec 4.6 step 1, Appendix B.
- Thread / PR: M8

## 2026-10-21 — Lint keeps the River and the identity host apart (M8)
- Decision: eslint's import rules now refuse `**/identity/**` in `src/river/` and `**/river/**`
  in `src/identity/` (CLAUDE.md constraint 7), next to the pg and network rules; a lint test proves
  it. The River's DID code (src/river/auth/did.ts) has its own small Ed25519/multikey helpers
  instead of importing the identity host's.
- Why: constraint 7 was enforced by review only; M8 is the first River code that reads what the
  identity host produces.
- Thread / PR: M8

## 2026-10-21 — forIdentity() settings and the lookups (M7)
- Decision: identity policies key on two transaction settings. `app.person_id` reaches a person's
  own rows in people, passkeys, did_log, keys, audit_log and recovery_tokens; `app.auth_request_id`
  reaches one auth_requests row (its random uuid is the browser's capability, like a ceremony id).
  `forIdentity({ personId?, authRequestId? })` sets them with bound `set_config` calls; with
  neither it sees nothing. Before a person is known, six SECURITY DEFINER functions (owner
  postgres, `search_path = ''`, EXECUTE for identity_app only) each return an id or a boolean:
  `person_by_credential` (sign-in), `person_by_code` (did.jsonl, recover-dids),
  `person_for_recovery` (verified address only), `email_in_use`, `person_by_token` (emailed
  links; the caller checks purpose, expiry and use in the person's context) and `person_codes`
  (recover-dids `--all`). A new person's id is generated first and set as `app.person_id`
  before the insert, so the same policy covers creation.
- Why: spec 3 (ENABLE + FORCE RLS, one role per app, no BYPASSRLS) and the M1 spec question.
  Unauthenticated flows need a way in that is narrower than "identity_app reads every row".
- Alternatives: `USING (true)` policies for identity_app (RLS in name only); a lookup role with
  BYPASSRLS (a second login to guard); one wide definer function returning rows.
- Thread / PR: M7 (claude/m7-identity-host)

## 2026-10-21 — didwebvh-ts 2.8.0 (M7)
- Decision: pin `didwebvh-ts` 2.8.0 exactly. Checked 2026-10-21: the package's LICENSE file and
  package.json say Apache-2.0 (its README still says MIT; the LICENSE governs), which is
  compatible with AGPL-3.0. 2.8.0 (2026-06-26) is the latest; no 3.0.0 is published (dist-tag
  latest = 2.8.0). It declares no `engines`; it is an ESM bundle (bun-built) with its runtime
  dependencies inlined and no install scripts, and it runs on Node 24.22 (create, update, resolve
  verified here). It installs with npm 12 into this repo's root package (the repo has no npm
  workspaces; `ui/` is a separate package that doesn't use it). Use: `createDID`, `updateDID` and
  `resolveDIDFromLog` only, in memory, with our own Ed25519 signer and verifier over node:crypto.
  Its `resolveDID()` calls global `fetch`, so nothing calls it (constraint 3), and witness proofs
  are always passed in as none so its witness fetch never runs. Two quirks: its `{DID}` document
  placeholder produces logs its own resolver rejects, so the template uses `{SCID}`; and with
  `NODE_ENV=test` (Vitest) it writes each log it creates to `./test/logs/` (gitignored).
- Why: spec 4.6 ("pin an exact version after confirming its LICENSE, Node 24 support and whether
  3.0.0 is released"). Hand-rolling did:webvh is out.
- Alternatives: a `^2.8.0` range (a minor release could change log output); waiting for 3.0.0.
- Thread / PR: M7

## 2026-10-21 — Passkey options (M7)
- Decision: `@simplewebauthn/server` 14.0.3 and `@simplewebauthn/browser` 14.0.0 (MIT), exact.
  Registration: RP name "Mosaic ID", RP ID `RP_ID`, `residentKey: 'required'` (and
  `requireResidentKey`), `userVerification: 'required'`, attestation `none`, algorithms EdDSA,
  ES256, RS256, `user.id` = the 32 random bytes of `webauthn_user_id`, `user.name` = the email
  address (only the authenticator keeps it), display name the optional name or the address.
  Sign-in: empty `allowCredentials`, user verification required. Each options call writes a new
  32-byte challenge to the auth_requests row; verification compares against that row only, and
  the row is marked used (`UPDATE … WHERE used_at IS NULL AND expires_at > now`) before the note
  is signed. A recovery passkey reuses the person's `webauthn_user_id`, so it is the same user.
- Why: spec 4.6. Attestation adds nothing for a demo with no authenticator policy.
- Thread / PR: M7

## 2026-10-21 — Identity table shapes (M7)
- Decision: beyond spec 3.2's columns: `auth_requests` has `purpose` (authorize, recover,
  change_email), `person_id`, `pending` (jsonb: a sign-up's address, user handle and name; a new
  address; a recovery's token id) and `created_at`; client fields are all set or all null.
  `recovery_tokens` has `email` (the address a verify_email token confirms: the sign-up address
  or the one being changed to), `auth_request_id` (the authorize request a recovery continues)
  and `created_at`; CHECKs cap expiry at 15 minutes (recover) and 24 hours (verify_email).
  `people.email` is stored lowercased with a plain unique index. `keys` stores iv||tag||data in
  bytea for both the private key and the wrapped data key, `public_jwk` without `d`, at most one
  active key per person. `did_log` rows are one JSON line each, append-only by grant and trigger.
  `audit_log.action` adds recovery_requested, recovered, email_verified, email_change_requested
  and did_recovered to 3.2's four. No DELETE grant on any identity table; UPDATE only on the
  columns flows change. Every expiry is compared with a time the app passes in.
- Why: spec 3.2 lists columns, not how ceremonies carry state between their two steps.
- Thread / PR: M7

## 2026-10-21 — The identity host keeps no session (M7)
- Decision: no identity-host cookie at all. Sign-in, sign-up and recovery each finish in one
  ceremony; changing the email starts with a fresh passkey check (spec 4.6) that identifies the
  person. `SESSION_SECRET` stays unused on the identity host for now. Every POST must carry
  `Origin: IDENTITY_PUBLIC_ORIGIN`. Pages send `Referrer-Policy: same-origin` (tokens in URLs
  never leave as a Referer; with `no-referrer`, browsers send `Origin: null` on form posts).
- Why: fewer secrets and nothing to steal; spec 4.6 asks for a fresh check anyway.
- Thread / PR: M7

## 2026-10-21 — Emailed links (M7)
- Decision: a link's GET shows a page with one button; only the POST (or, for recovery, the
  finished passkey registration) uses the token, so mail scanners that open links don't spend
  them. A recovery token is marked used in the same transaction that adds the passkey; a
  cancelled passkey prompt leaves the link working until it expires. A recovery link sent from the
  authorize page carries that request's id; when the link is used while that request is still
  open (10 minutes), the new passkey's ceremony copies its client, state and nonce and finishes
  with the note; otherwise the page says "Go back to Mosaic River and sign in". A new verify link
  makes the person's earlier unused verify links stop working. "Lost your passkey?" sends to
  verified addresses only, at most 3 links per person per hour (counted in the database), and
  writes recovery_requested (with a hashed IP prefix) to the audit log.
- Why: spec 4.6 (single use, 15 minutes / 24 hours, continue the sign-in).
- Thread / PR: M7

## 2026-10-21 — Rate limits in memory (M7)
- Decision: fixed windows per IP in the function's memory: /authorize and both sign-in steps 60
  per 10 minutes, sign-up 10 per hour, recovery 10 per 15 minutes per IP and 3 per hour per
  address (hashed, known or not, answered with the usual message), emailed links and change email
  60 per 10 minutes. The IP is `x-real-ip` on Vercel, the socket address elsewhere. On Vercel each
  warm instance counts alone, so this slows one client rather than capping globally; the
  per-person recovery cap is the durable one.
- Why: spec 4.6 asks for per-IP and per-address limits; a database table for counters would be
  one more table and policy for a demo.
- Alternatives: a `rate_limits` table (durable, global); Vercel's firewall rules (not code).
- Thread / PR: M7

## 2026-10-21 — The "confirm your email" reminder (M7)
- Decision: after sign-up, and after any sign-in while the address is unconfirmed, the authorize
  page shows "Please confirm your email" with the masked address and a "Continue to Mosaic River"
  link holding the redirect (the note inside lives 120 seconds), plus a link to send it again
  (the change-email page, which re-sends for the same address).
- Why: spec 4.6 ("the account works before the link is clicked, with a reminder until it is").
- Thread / PR: M7

## 2026-10-21 — Test clock and test routes on the identity host (M7)
- Decision: with `TEST_ROUTES=1` (refused on Vercel) the identity host mounts `GET/DELETE
  /test/mailbox` (capture transport), `POST /test/clock {offsetMs}` (moves the identity clock that
  every expiry check and note time reads) and `POST /test/rate-limits/reset`.
- Why: checks 35 and 36 need links that fail after 24 hours and 15 minutes, and a mailbox.
- Thread / PR: M7

## 2026-10-21 — recover-dids (M7)
- Decision: `npm run recover-dids -- --key-file <pem> (--code <code>… | --all)`, or without
  `--key-file` a pasted PEM on stdin. The key is an Ed25519 PKCS#8 PEM (`openssl genpkey
  -algorithm ed25519`); a file inside the working tree is refused, and no environment variable is
  read for it. `--print-public-key` prints the multikey for `IDENTITY_RECOVERY_PUBLIC_KEY`. The
  database (`DATABASE_URL` as identity_app) and the master key that seals the new custodial keys
  come through env.ts, from `.env.recover` (gitignored) or the shell. Per person, one transaction
  with the person's row lock: verify the log, check the key is an update key, retire the old
  custodial key, seal a new one, append the entry (updateKeys [new, recovery]; `#key-1` the new
  key), verify again (same SCID and DID), audit `did_recovered`.
- Why: spec 4.6 and check 37. After a lost master key Adam deploys a new one first, then runs this
  with it.
- Thread / PR: M7

## 2026-10-21 — Identity pages: CSP and styles (M7)
- Decision: the Express pages and `identity/vercel.json` send the same CSP (a unit test keeps them
  equal): `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:;
  font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self';
  frame-ancestors 'none'`. Styles are one small sheet at `/identity.css` with its own `--id-*`
  tokens (light and dark), since the River's themes live in `ui/`. Changing `identity/vercel.json`
  makes the PR needs-adam.
- Why: spec Appendix B.
- Thread / PR: M7

## 2026-10-21 — Resend through the fetch guard (M7)
- Decision: `EMAIL_TRANSPORT=resend` posts `{from, to: [address], subject, text}` with
  `Authorization: Bearer RESEND_API_KEY` to `https://api.resend.com/emails` through the fetch
  guard. A failed send is logged as one redacted line and never fails the request. No test calls
  Resend; a unit test checks the request against a MockAgent.
- Why: ADR-001 item 4; spec 4.6.
- Thread / PR: M7

## 2026-10-21 — The River's CSP lives in vercel.json; vite preview serves the same header (M6)
- Decision: `vercel.json` sends `Content-Security-Policy: default-src 'self'; script-src 'self';
  style-src 'self'; img-src 'self' https:; font-src 'self'; connect-src 'self'; object-src 'none';
  base-uri 'self'; form-action 'self'; frame-ancestors 'self'` on every path (UI and API).
  `ui/vite.config.ts` reads that header from `vercel.json` and serves it unchanged from `vite
  preview` (CI's e2e target), so the tests run under the production policy. The dev server adds a
  per-start nonce to `script-src` and `style-src` (`html.cspNonce`) for Vite's inline React Refresh
  preamble and injected styles; nothing else differs. `build.assetsInlineLimit: 0` keeps fonts and
  images as files (no `data:`). Circle colors reach CSS as a custom property set through the CSSOM,
  which `style-src 'self'` allows; no `style=""` markup. Changing `vercel.json` makes the PR
  needs-adam.
- Why: spec Appendix B; one source for the policy, proved by `tests/unit/ui/csp.test.ts` and the
  e2e CSP test (no violation messages on load and with the dialog open).
- Alternatives: a `<meta http-equiv>` CSP (can't set `frame-ancestors`, and dev would need its
  own copy); serving the UI through Express (Vercel serves `ui/dist` statically).
- Thread / PR: M6 (claude/m6-river-ui)

## 2026-10-21 — The dev and preview /api proxy keeps the browser's Host (M6)
- Decision: `changeOrigin: false` on the Vite proxy, so the API sees the page's own hostname, as
  it does behind Vercel's rewrite. `localhost` and `127.0.0.1` stay in `INSTANCE_HOST_ALIASES`;
  `unknown.localhost` (Chromium resolves `*.localhost` to loopback and Vite allows it) gets
  `unknown_host`, which the e2e test uses for check 26's 404 page through the real stack.
- Why: with `changeOrigin: true` every page host reached the API as `localhost:3000`, so the
  unknown-host page could only be faked.
- Thread / PR: M6

## 2026-10-21 — The unknown-host page is a client page with HTTP 200 (M6)
- Decision: the UI asks `/api/feed`; on `404 unknown_host` it renders the 404 page (title "Not
  found", the API's message). The HTML itself comes from Vercel's static `index.html` with status
  200. Other paths than `/` show "This page doesn't exist." with a link home.
- Why: Vercel serves `ui/dist` statically and doesn't know instances; a real 404 status would need
  a function in front of every page view.
- Alternatives: an edge middleware checking the host (another Vercel feature and a database call
  per page view).
- Thread / PR: M6

## 2026-10-21 — Visitor read state in localStorage (M6)
- Decision: `mosaic-river:read` holds a JSON array of item ids, newest mark last, capped at 2000.
  "Mark read" toggles to "Mark unread"; "Mark all read" marks the items loaded in the current view
  (current filters, every loaded page); opening an item's Open link or a link inside its text marks
  it read. Unreadable or blocked storage counts as nothing read. The page makes only
  `GET /api/feed` requests (e2e checks it).
- Why: spec F4, check 23 visitor part. Members' server-side read state arrives in M8.
- Thread / PR: M6

## 2026-10-21 — Feed page layout and placeholders (M6)
- Decision: desktop (56rem and up) puts search, circles and content type in the left column and
  no chips above the feed (mockups README: all filtering stays in the left column). Phone: a header
  with the logo, a search toggle and Follow; a chip row with a content-type select ("All types")
  then circle chips; bottom tabs Feed, Circles, Following, You, where the last three say what comes
  later. Follow opens a short note that following comes with an account. No mode picker until M10.
  Filters are mirrored in the address bar (`?circle=&type=&q=`) so a reload keeps them. Paging is
  a "Load more" button. Avatars that fail fall back to initials. Content links inside an item's
  sanitized HTML get `target="_blank"` on the client (the sanitizer already forces `rel`).
- Why: spec F1, F4, F5 and the phone paragraph; the mockups are a starting point.
- Thread / PR: M6

## 2026-10-21 — Layout tokens in theme.css (M6)
- Decision: sizes that don't change with the theme (avatar, control height, sidebar and feed
  widths, tab bar, dot, border width, bold weights) are `:root` custom properties in
  `ui/src/styles/theme.css`; `mosaic.css` and `civic.css` keep only theme tokens. The phone/desktop
  breakpoint (56rem) is written in the media queries, which can't read custom properties.
- Why: CLAUDE.md "Themes" (no hard-coded sizes) without making each theme repeat layout values.
- Thread / PR: M6

## 2026-10-21 — @axe-core/playwright for check 31 (M6)
- Decision: `@axe-core/playwright` `^4.14.0` (MPL-2.0, Deque's own package; locked at 4.14.0) as
  a root dev dependency. Check 31 fails on any `critical` or `serious` violation; it also tabs
  through the page and requires every visible control to take focus.
- Why: check 31 names axe; dev-only, never shipped.
- Thread / PR: M6

## 2026-10-21 — UI helpers are tested from the root Vitest suite (M6)
- Decision: pure UI logic lives in `ui/src/lib/` with no React or DOM, and `tests/unit/ui/`
  imports it directly. The UI package gets no test runner of its own.
- Why: one `npm run check`; Playwright covers the components.
- Thread / PR: M6

## 2026-10-21 — forHost() and the hostname lookup arrive in M5
- Decision: `forHost()` (src/db/context.ts) opens a transaction with no settings; row-level
  security lets it read `river.instances` and nothing else (tests/api/db/host.test.ts). The River
  maps the request's hostname (Express `req.hostname`, lowercased, port and trailing dot dropped)
  to its instance; `INSTANCE_HOST_ALIASES` and every host when `VERCEL_ENV=preview` map to the seed
  instance; anything else gets JSON 404 `unknown_host` on API routes (M6 adds the page). Lookups are
  cached per process for a minute. CLAUDE.md constraint 2 names `forHost()` in this PR.
- Why: Adam approved the helper for M6, but the feed (M5) needs the instance first.
- Thread / PR: M5 (claude/m5-feed-api)

## 2026-10-21 — @vercel/functions for waitUntil
- Decision: `@vercel/functions` `^3.9.11` (Apache-2.0, Vercel's own package; locked at 3.9.11,
  released 2026-10-02), used only for `waitUntil`. Outside Vercel it is a no-op and the work simply
  runs on in the long-lived dev server.
- Why: spec 4.5 names it for fetches still running when the response budget ends.
- Alternatives: none that keep a Vercel function alive after the response.
- Thread / PR: M5

## 2026-10-21 — A test-only adapter clock
- Decision: `TEST_CLOCK_NOW` (ISO 8601) fixes the River's adapter clock (`src/river/clock.ts`)
  for API and e2e runs, so first-fetch URLs (`since` = now − 90 days) match the hub recordings.
  It is a test-only variable like `FETCH_FIXTURES_DIR`: refused when `VERCEL` is set. Database
  time (`now()`, the claim statement, retention) is never affected. CI's `.env` sets it.
- Why: M3 follow-up; recordings carry a fixed `since`.
- Alternatives: re-recording on every run (network in tests); faking Date in the server.
- Thread / PR: M5

## 2026-10-21 — Sample spaces (M5)
- Decision: seven sample spaces in a migration (hosted gets them too): Riverside Rovers Soccer Club
  (club), The Okafor Family (family, photos), The Millbrook Ledger (publication), Elm Street
  Neighbors (neighborhood, an event with `raw.startTime` and `raw.location.name`), Safe Streets for
  Millbrook (organization: an issue campaign), Small Town Signals (podcast: one episode, so check 5
  finds exactly one) and Trailhead TV (video). Canonical URL `urn:mosaic:sample:{slug}`: unique,
  and no adapter or the fetch guard (https only) accepts it. Item source ids extend it
  (`…:{slug}:1`). Each item keeps its age in `raw.sample.age` (and an event's `raw.sample.startsIn`);
  `river.restamp_samples(at)` dates them at seed time and daily. Images are SVG placeholders in
  `ui/public/samples/`, referenced by same-origin paths, with alt text; a podcast or video's
  `duration` sits on its cover image's media entry, since there is no audio or video file. The
  seed instance follows all seven by URN; Soccer, Family and Neighborhood list their sample, News
  and ideas the publication and the podcast; the campaign and the video channel are in no circle.
- Why: spec 4.4, Appendix D; seed_follows and default_circles must agree (catalog test).
- Alternatives: a `sample:` URL scheme (looks fetchable to people); seed.sql (never reaches hosted).
- Thread / PR: M5

## 2026-10-21 — How the refresh writes (M5)
- Decision: a followed name finds its space without a request: exact canonical URL first, then a
  hub by its origin, a fediverse handle by the handle cached in `manifest.actor.handle`, a profile
  URL by actor id or home URL. A name with no space is resolved within the budget and inserted
  with `ON CONFLICT (canonical_url)`; a failed resolve waits 120 s per process before retrying.
  Claims for one request run in one transaction, one exact 4.5 statement per space. Each page is
  stored in its own transaction with one `INSERT … SELECT FROM jsonb_to_recordset … ON CONFLICT
  (space_id, source_id) DO UPDATE` that refreshes every column but `is_final_result`. After the
  fetch: space columns (`etag`/`etag_url` only when the adapter reports them, `newest_item_at` only
  grows, a refreshed fediverse actor's name and icon), a `streams` row for every stream key seen,
  titles and ends from `StreamUpdate`s, `river.mark_stream_follows_ended()` for ended streams, and
  the final result moved to `finalItemSourceId` only when at least as new as the current one. A
  304 marks the space ok. Any failure leaves `fetch_status` error (blocked for server-only),
  `error_count + 1` and the F6 sentence in `last_error`; the claim is released in `finally` with
  the database's clock. Withdrawn probes: at most 5 per hub space per refresh, streams with no
  item in 7 days and not checked for a day (by the adapter clock), any outcome stamps
  `last_checked_at`, only `exists = false` hides. Only the feed's first page refreshes; paging reads.
- Why: spec 4.2, 4.3, 4.5 and the M3/M4 follow-ups.
- Thread / PR: M5

## 2026-10-21 — The feed API's shape (M5)
- Decision: `GET /api/feed?mode=&circle=&type=&q=&cursor=` answers `{ instance, mode, circles,
  items, nextCursor, empty, emptyMessage, refresh: { claimed, pending } }`. Each item has its id,
  kind, time, title (else the stream's title), summary, sanitized HTML, url (null for samples),
  media, author, boost, civic details, final-result flag, `event` (start and place, when known),
  `source` (`live` or `sample`) and `space` (id, name, icon, category, adapter). Visitor circles
  come from `default_circles` and are named by their name (`circle=News and ideas`); members' will
  be ids. `type` takes the F5 names, singular or plural, any case. Search: `plainto_tsquery
  ('simple', q)` on `items.search`, or the source name by `ILIKE` with `%`/`_` taken literally. 30
  items a page, keyset cursor on `(published_at, id)` with Postgres's own timestamp text (keeps
  microseconds). Bad mode, circle, type or cursor: 400. `Cache-Control: no-store`; no cookie.
  The visitor's scope (`visitorView`, `scopeFor`) is follows + circles + one civic-role circle;
  M8/M9 build the same shape from a member's rows under `forAccount()` and add stream rules.
- Why: spec F1, F5, F9, 4.5; check 23 (visitors cause no writes beyond the refresh).
- Thread / PR: M5

## 2026-10-21 — The daily job (M5)
- Decision: `river.daily_job(at timestamptz DEFAULT now())`, scheduled by pg_cron as
  `river-daily` at `17 4 * * *`, as postgres. In order: Ended follows for ended streams (in case a
  refresh missed it), mark followed streams' `keep_final_result`, retention (items older than 90
  days except final results of marked streams and samples), delete follows ended more than 90
  days ago, delete `river.auth_attempts` (created_at) and `identity.auth_requests` (expires_at)
  older than a day when those tables exist, re-stamp samples. It returns counts as jsonb.
  river_app can't execute it or `restamp_samples`; it may execute the SECURITY DEFINER
  `river.mark_stream_follows_ended(stream_id)`, which only copies an ended stream's `ended_at`
  onto `ends_with_stream` follows (the refresh runs with no account, and follows are visible only
  to their own account). pg_cron 1.6.4 is preloaded in the local stack (checked); Supabase offers
  it on hosted projects too, which `deploy-migrations` proves on merge (no hosted access from
  here). The migration runs `CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog`.
- Why: spec 3.1, 4.2, 4.5; CLAUDE.md "Database" (one pg_cron job, SQL only).
- Alternatives: river_app DELETE grants and an app-side job (Hobby has no cron, and the job must
  cross instances).
- Thread / PR: M5

## 2026-10-21 — Fediverse resolve, identity and manifest (M4)
- Decision: WebFinger rel=self (activity+json or the ld+json profile type), then the actor with
  `Accept: application/activity+json` (its `id` must be on the host that served it), then NodeInfo
  (well-known, newest 2.x). When a Mastodon server refuses the actor with 401/403, resolve uses
  `/api/v1/accounts/lookup` (Group if `group`, Service if `bot`, else Person) and the outbox
  `{account.uri}/outbox`; any other server answering 401/403 is `server_only`. `canonicalUrl` and
  `actorId` are the actor id, `homeUrl` its `url`, `feedUrl` the outbox, `network` NodeInfo's
  lowercased software name. The manifest holds `actor` (with `fetchedAt`, `expiresAt` 24 h on),
  `software`, `via` (`activitypub` or `mastodon_api`) and `mastodonAccountId`; `fetchNew`
  refreshes an expired actor, best effort.
- Why: spec 4.3; the actor id is the stable IRI; mastodon.social refuses unsigned actor reads.
- Alternatives: mark mastodon.social spaces blocked (loses two seeds); the handle as canonical URL.
- Thread / PR: M4

## 2026-10-21 — Fediverse source ids, hidden items and kinds (M4)
- Decision: `source_id` is the activity IRI; REST statuses use `{status.uri}/activity`, and a
  reblog its own `uri`, matching the outbox (tested on real data, so switching paths never
  duplicates). Stored hidden: non-public (Public missing from `to`, so unlisted too), all replies
  including self-replies, Updates, unknown types, Announces without an object id, Group-relayed
  replies; entries without an id are dropped. `Link` attachments (previews) don't count toward
  photo or media; Question → post; Image → photo; titles from `name` for article, video,
  podcast, event and photo only; a Note's content warning is the summary; Video/Audio without
  attachments take file and duration from `url` Links (PeerTube).
- Why: spec 3.1, 4.3; keeping hidden items lets stop-at-known match every activity.
- Alternatives: object ids (an Update at the top would stop stop-at-known early); drop non-public.
- Thread / PR: M4

## 2026-10-21 — Fediverse boosts, input and errors (M4)
- Decision: `boostOf` = `{objectId, host, url?, author?}` from the Announce; an embedded Create
  (FEP-1b12 Groups, e.g. WordPress) supplies the inner object's sanitized content, title and media.
  `dereferenceBoost(boost, { guard, budget })` with `createBoostBudget(20)` per refresh; the object
  must come from its id's host. The follow box accepts `@name@server`, `acct:name@server` and https
  profile URLs in known fediverse path shapes, never bare `name@server` (indistinguishable from an
  email address; constraint 7). Guard and HTTP failures throw `AdapterError` (`refused` or
  `unreachable`; a 429 is unreachable with "The server asked us to wait before reading it again",
  never retried); server-only is returned as `fetchStatus: "blocked"`, a lasting state.
- Why: spec 4.3 (boosts fetched only when opened, at most 20 per refresh), F6.
- Thread / PR: M4
## 2026-10-21 — The sanitizer and the item model come first in M3
- Decision: `src/shared/sanitize/` (sanitize-html ^2.18.1, MIT) implements Appendix B's allowlist:
  only absolute https hrefs survive (a relative href would resolve against the River's origin),
  `rel="nofollow noopener noreferrer"` on every link, `class` only as `invisible`/`ellipsis`.
  `toPlainText()` strips all tags for titles and summaries. `src/shared/items/` holds the one item
  shape (ADR-003) and the `Adapter` contract; adapters are pure (fetch through a given guard,
  return items plus space and stream changes, `onPage` per page) and M5's refresh writes them.
  Both were written before M3 and M4 forked so the two adapters share them.
- Why: spec §7 puts the sanitizer in M3, and M4 needs it and the contract too.
- Thread / PR: M3

## 2026-10-21 — The hub allowlist is a code table with per-processType rows (M3)
- Decision: `src/river/adapters/civicHub/allowlist.ts` lists spec 4.2's rows keyed by activity,
  object and optional processType (a processType row wins). Hubs send a proposal's or project's
  end as `civic:End civic:Process` with processType `civic.proposal`/`civic.project`, so those
  get rows ("A proposal closed" / "A project archived") beside the spec's `civic:Proposal` /
  `hub:Project` rows. Create and Update hub:Project are two rows. Only `Create hub:Aggregation`
  with processType `civic.meeting_summary` is kind `article`. The row's text goes in
  `civic.label`, a new optional CivicDetails field.
- Why: spec 4.2, ADR-003; the recorded hubs send the civic:Process form.
- Alternatives: object type only (real proposal and project ends would read "A process ended").
- Thread / PR: M3

## 2026-10-21 — Hub templates, official responses and final results (M3)
- Decision: `hubTemplates.ts` uses the spec's keys plus `brief.headline`, `result.total_votes`
  and `response.official_title`, never a response's excerpt; template text is plain, at most 500
  characters, with AS2 `object.summary` as fallback. `Create hub:OfficialResponse` shows unless
  `hub:payload.feed_anchor === false` (one card per burst, as the hub does). Per fetch and stream,
  the latest Announce civic:Result or Create civic:Outcome is the final item, else the civic:End;
  `finalItemSourceId` is set whenever a stream has a candidate (Floyd's briefs never send End),
  and `status: ended` only when an End arrives.
- Why: spec 4.2; results arrive after the End, often in a later refresh.
- Alternatives: only the four named keys; mark finals only after an End in the same fetch.
- Thread / PR: M3

## 2026-10-21 — Hub paging, errors, ETags and resolve (M3)
- Decision: first fetch when `newestItemAt` is null, else refresh. `next` is followed as given,
  only on the feed's origin, never to a page already read; items dedupe on `sourceId` within a
  fetch. ETag and `etagUrl` come from the first page (null when absent). A first-page failure
  throws `AdapterError`; a later one keeps earlier pages with `fetchStatus: "error"`.
  `newestItemAt` counts hidden items. `accepts()` takes URLs and bare hosts, not `@name@server` or
  `https://server/@name`. `civic.json` gives `not_a_space` for `no_hub`, a non-200, non-JSON, or
  a missing name, `space.id` or https `feeds[0]`; a 5xx is `unreachable`. Icons only if https.
- Why: spec 4.2, 4.5, F6.
- Thread / PR: M3

## 2026-10-21 — Hub fixture clock and recorder (M3)
- Decision: `tests/fixtures/civicHubClock.ts` fixes `now` at 2026-10-21T00:00:00Z. The recorder
  (`scripts/recorders/civicHub.ts`) runs the adapter over a recording guard, so replayed URLs are
  exactly what the adapter sends, and clears each hub's folder first. Derived sequences live
  inline in tests, labelled; none are under `tests/fixtures/http/`. API and e2e replay of hub feeds
  needs the server clock at that time (M5).
- Why: feed URLs carry `since`.
- Thread / PR: M3

## 2026-10-21 — The fetch guard's shape (M2)
- Decision: `src/shared/fetch/` exports `createFetchGuard(options)` and a process-wide
  `getFetchGuard()` / `guardedFetch()`. It runs on an undici `Agent` whose `connect.lookup`
  resolves, checks every answer and pins the socket to the first, so the address checked is the
  address connected to (the hub did the same through node:http). Before any hop is sent, the
  host is checked: IP literals against the ranges, names through the resolver (any blocked answer
  refuses), and `localhost` / `*.localhost` before DNS. https only at every hop, at most 3
  redirects, 2 MB, 6 s across all hops and queueing, 2 in flight per host (per process, with a
  queue), User-Agent and Host always the guard's. A 429 or 503 with Retry-After (seconds or a
  date, capped at an hour) makes the guard refuse that host until then (`retry_later`); it never
  retries. Errors are `FetchError` with a code; `followMessage()` maps the four "off limits" codes
  to "This address can't be followed" and the rest to "We couldn't reach that address" (spec F6).
  The hub's dev flag that allowed private addresses is not ported: Appendix B forbids any such
  override, and an injected resolver's answers are checked like any other. Adapters should take a
  `FetchGuard` parameter that defaults to `getFetchGuard()`.
- Why: spec Appendix B, ADR-001; the hub's guard, with an injectable resolver and Dispatcher.
- Alternatives: a new Agent per request pinned to one IP (no connection reuse); node:http as the
  hub has it (no way to inject a MockAgent).
- Thread / PR: M2 (claude/m2-fetch-guard)

## 2026-10-21 — Fixture format and replay (M2)
- Decision: one JSON file per request under `tests/fixtures/http/<host>/` (`url`, optional
  `method` and `requestHeaders`, `status`, `headers`, text `body`); see its README. Replay builds a
  MockAgent from the files and a resolver that answers only recorded hosts with a stand-in public
  address, and runs the real guard, so checks behave as in production with no network.
- Why: spec 6 and CLAUDE.md "Code" (replay through FETCH_FIXTURES_DIR in API and e2e tests, MockAgent
  in unit tests); the README left the format to M2.
- Alternatives: one file per host (large diffs on re-record); a HAR file (much more than tests read).
- Thread / PR: M2

## 2026-10-21 — undici and the network lint rules
- Decision: `undici` `^7.30.1` (MIT), the major Node 24 bundles, is a dependency. Lint forbids
  `undici`, `node:http(s)` and `http2` imports, and the global `fetch`, everywhere on the server but
  `src/shared/fetch/`. `src/shared/http/` (the inbound Vercel adapter, node:http types only) and
  the identity host's browser script are exempt. ESLint replaces a rule's options when two config
  blocks match one file, so the import rules are three blocks with disjoint files.
- Why: ADR-001 ("no other module imports undici, node:http or node:https, or calls global fetch").
- Thread / PR: M2

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
  Update (Adam, 2026-10-20): Supabase's verify-full needs its own CA, so Adam sets
  `DATABASE_CA_CERT` on both Vercel projects (`river` and `mosaic-id`) from the start.
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
