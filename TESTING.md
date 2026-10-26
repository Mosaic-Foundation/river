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

- 2026-10-26, sign-in limits (security review item 4): API `signin` (60 starts and 60 callbacks
  per address, then 429); API db `dailyJob` (attempts older than an hour go); unit `riverSignIn`
  (one fresh DID read per DID per minute). `POST /api/test/rate-limits/reset` (TEST_ROUTES) clears
  the River's limits: `requireApi()`, `signin.test.ts` and the e2e `resetLimits` call it. Unit
  721, API 179.
- 2026-10-26, follow caps (security review item 3): API db `followCap` (new: the 2,000 cap by
  the follow box, a stream rule and an import; mutes allowed; an over-cap import stores nothing;
  two concurrent imports can't both pass); API `blueskyImport` (preview 20 and import 10 per
  account, then 429); unit `riverRateLimit` (new). Unit 720, API 178.
- 2026-10-26, refresh budget (security review item 2): unit `blueskyRotation` caps every other
  adapter per open (2,000 feeds, 2,000 fediverse accounts and 50 hubs give 12 each, in rotation
  order, then the next 12), and skips spaces inside the claim's 120 s floor. Unit 719.
- 2026-10-26, feed reader linear time (security review item 1): unit `rssFeed` gains timed
  cases (each under 1 s with `performance.now()`) for 2M stray `<`, a tag that never closes,
  quotes that never close, 1,000 xmlns over 20,000 children and 50,000 unclosed `<link` tags,
  plus the 64-declaration cap, namespace scoping and `constructor:`/`toString:` prefixes. Unit 718.
- 2026-10-26, where a Following row's follow came from: unit `ui/following` (`originLine`: Added
  by you, Seed copy, Imported from @handle or Bluesky, nothing for unknown or linked); API
  `blueskyImport` (the page's `origin` for seed, manual and import rows, null for an admin-written
  follow without one); e2e `bluesky.spec.ts` (a hand follow's line, a seed row's, every imported
  row's). The import tests' stand-in DIDs are distinct (`aaaa…` API removals, `bbbb…` e2e,
  `cccc…` API unknown), since API and e2e share one database. Old schema checked by dropping the
  columns: the page loads with every origin null. Unit 710, API 174, e2e 146 (145 locally; check
  37 needs `TEST_RECOVERY_KEY_FILE`).
- 2026-10-25, follow origins: unit `followOrigin` (the column check and cache); API
  `blueskyImport` (origins recorded; an import over a hand-made follow keeps it manual; a stream
  rule is manual; the import's own removals marked; an admin-written stand-in
  for an account an earlier import added); e2e `bluesky.spec.ts` (the two headings). Old schema
  checked by dropping the columns locally. Unit 707, API 172, e2e 146.
- 2026-10-25, Bluesky import removals: unit `bluesky/follows` (skipped DIDs, an incomplete
  list), `ui/following` (the button, who, the unfollow sentence); API `blueskyImport` (a second
  member: the removal list, confirmed unfollows only, ids off the list ignored, 400s); e2e
  `bluesky.spec.ts` (the confirm list). Unit 704.
- 2026-10-25, link cards and quotes on an item's own page: e2e `bluesky.spec.ts` (the reader
  at a post's address with its link card and quote); `revisions3.spec.ts` (a fediverse address
  shows the reader; the bar checks use the refused hub page). Full e2e 146.
- 2026-10-25, Following edge to edge: e2e `following.spec.ts` (the page's edges at 1920 and
  1440 px, one column at 390 px).
- 2026-10-25, the Following page's profile menu: API `following.test.ts` (the page's `viewer`);
  e2e `profile.spec.ts` (the member's menu on Following, Sign out from it; a visitor's menu).
- 2026-10-24, UI revisions 11 item 2 (one source at a time):
  - API `feed.test.ts`:
    - the `sources` list: sorted, covers every item's space, unchanged by filters and on later
      pages, smaller in Civic;
    - `source=` alone and with a type; a news source in Civic gives nothing; a malformed id gets
      400 `bad_source`.
  - API `signin.test.ts`: Mark all read with `source` marks only that source.
  - Unit `ui/filters`: the source counts as a filter and is named in the summary.
  - New e2e `revisions11.spec.ts`: the dropdown (groups, filter, URL, reload, clear), a card's
    source name, and the phone sheet's dropdown and summary.
  - Specs that opened a card by clicking `.card-source` (`revisions2`, `revisions3`, `revisions4`,
    `media`, `bluesky`) click `.card-kind` instead, since the name now filters. `filterColumn`'s
    last control is the Source dropdown. `revisions` and `revisions6` expect the Source section.
- 2026-10-24, UI revisions 11 item 1 (no Following link in the bar): `profile.spec.ts` checks the
  menu's items (My information, Following, Settings, Sign out) and no Following link in the
  bar; `modes.spec.ts` opens Following from the menu with Civic kept.
- 2026-10-24, UI revisions 10 (one filter button, narrowing gaps):
  - New e2e `revisions10.spec.ts`:
    - the wide button in Everything and Civic: no title or Clear all, as wide as search, turns
      at a type and at a network;
    - the column gap: 32 px at 1440 and under 16 at 1310 (three columns), 32 at 1100 and under
      16 at 930 (two).
  - `filterClear.spec.ts` covers "Clear the filter": it clears everything, focus stays on the
    button, the mode stays, and with nothing on the button opens the sections and focuses the
    first pill.
  - `revisions4` items 3-4 are removed (superseded). `revisions` and `themes` read the button.

- 2026-10-24, UI revisions 9 (profile menu, My information, dark mode):
  - Unit:
    - `ui/colorScheme` (saved choice, device fallback, blocked storage);
    - `ui/mosaicTheme` (dark surfaces and text, AA pairs);
    - `ui/civicTheme` now reads the light and dark blocks separately and holds both to AA.
  - New e2e `profile.spec.ts`:
    - the member's menu and My information with the DID, axe;
    - no DID in the top bar;
    - Sign out from the menu;
    - the visitor's menu;
    - the keyboard (Enter, arrows wrap, Escape, focus back);
    - 390 px;
    - dark on and off, kept across a reload, in Everything and Civic, with axe in dark;
    - a dark-preferring browser opens dark.
  - `signin.spec.ts` uses the menu. `revisions8` checks the profile button at the right edge.
  - Unit 700, e2e 137 (136 locally; check 37 needs `TEST_RECOVERY_KEY_FILE`).
- 2026-10-24, UI revisions 8 (Coming up back, circle pills, the whole window):
  - API `db/modes.test.ts`: Everything's Coming up finds a hub vote under 520 newer posts in
    another followed space. It reproduces the missing column on the old query.
  - Unit `plugins.test.ts`: Everything's empty Coming up.
  - New e2e `revisions8.spec.ts`:
    - Coming up shows in Everything at desktop width;
    - at 1920 and 1440 px the filters and Coming up meet the page's edges, with the feed centred
      at most 44rem;
    - at 1100 px the panel sits above the feed;
    - the top bar's brand and Follow meet its edges.
  - `revisions4` item 2 now covers circle pills:
    - several to a row;
    - four rows tall, then scrolling with the hint;
    - no scroll when they fit.
  - `revisions2`: the reader is wider than the feed and inside the old Coming up edge.
  - `themes`: checks a content-type pill.
  - Unit 689, API 162, e2e 131 (130 locally; check 37 needs `TEST_RECOVERY_KEY_FILE`).
- 2026-10-23, UI revisions 7 (circles menu on Following rows): new e2e `circlesMenu.spec.ts`
  (add and remove with every circle listed and the row's checked, a reload keeps it, the row
  changing before a held save and undone with its error when refused, Escape and a click outside
  close it, New circle… with the row in it and a taken name refused, keyboard only (Enter, Home,
  arrows wrapping, Space and Enter toggle, Escape, focus back on the button), a 390px bottom sheet
  measured after it slides in, axe). `following.spec.ts` reads the row's circles from the menu
  button. Unit `ui/following` (`toggleId`, `nextCircleColor`). Unit 688, e2e 125 (124 locally;
  check 37 needs `TEST_RECOVERY_KEY_FILE`).
- 2026-10-23, Import from Bluesky and the refresh rotation: new recordings of `@eff.org`'s
  follows (three pages of `getFollows`, 259 accounts, 25 hiding from signed-out readers). Unit
  `bluesky/follows` (every page, each account once, the 1,000 cap, a failing later or first page,
  refusals, the space an account becomes), `blueskyRotation` (intervals by quiet time, the cap of
  12 from 300, overdue order, a 10-hour simulation of 300 accounts reaching every one, the share for just-imported accounts, nothing due),
  `ui/following` (the import's sentences). API `blueskyImport.test.ts` (members only and Origin;
  the preview stores nothing; import into a circle, a re-import adds nothing; a feed open claims
  at most 12 Bluesky spaces; errors). e2e `bluesky.spec.ts` adds the import from the Following
  page (count, names, a circle as a radio, axe, the result). Unit 685, API 161, e2e 120.
- 2026-10-23, Bluesky network and cards: new e2e `bluesky.spec.ts` (a member follows `@bsky.app`
  by handle: preview with name, bio and the avatar attempted from cdn.bsky.app; filters by
  Bluesky; only Bluesky cards; no framing check, the body opens nothing, Open ↗ to bsky.app;
  "reposted"; a quoted post and a link card; axe). API `bluesky.test.ts` adds `network=bluesky`
  with `embed` (and none on other networks). Unit `feedScope` (bluesky network), `ui/embed`,
  `ui/boost` (`boostVerb`), `ui/format`; the Networks pills in `revisions` and `revisions6`
  specs list Bluesky. Unit 666, API 161, e2e 119.
- 2026-10-23, Bluesky adapter (ADR-009): real recordings from `public.api.bsky.app` and
  `plc.directory` (`npm run record-fixtures -- --bluesky`; four accounts, see
  `tests/fixtures/http/README.md`). Unit `bluesky/input` (what the follow box takes, routing),
  `bluesky/map` (text and facets by byte offset, link cards, photos and galleries with alt text,
  video as a thumbnail, quotes and unavailable quotes, reposts as boost cards, hidden replies,
  adult labels and `!no-unauthenticated`, every recorded entry), `bluesky/adapter` (resolve by
  handle, profile URL and DID with the DID document check, the well-known fallback, refusals,
  429; fetchNew paging, stop rules, handle change). API `bluesky.test.ts` (preview with bio;
  follow and see posts and reposts; handle, URL and DID reach one space; malformed input is a 422). `revisions4.spec.ts` scrolls
  its hub card into view before the framing check. Unit 664, API 160, e2e 118.
- 2026-10-23, UI revisions 6 (mobile filter sheet): new e2e `revisions6.spec.ts` (11 tests at
  390x844: the button, its count and one-line summary; the sheet's height, handle, content and
  wrapping pills; live updates behind it; Show results, Back, a tap outside and a swipe down keep
  the selections (and Forward onto the old entry doesn't make a later Back step twice; Enter on
  the handle closes after a short drag); Clear all stays open; Civic mode; the modal dialog, focus in and back, Escape;
  Tab reaches every control; reduced motion; axe in both modes). `openSheet` waits for the slide
  to finish before measuring. Phone steps in `revisions`, `revisions4`, `river` and `modes`
  specs use the sheet instead of the chip strip; `river.spec.ts` matches the You tab exactly
  ("Filter your River" contains "you"); unit `ui/filters` (count, summary). Unit 590, e2e 118.
- 2026-10-23, UI revisions 5 (feed top, Citizen Dashboard): new e2e `revisions5.spec.ts` (8
  tests: nothing visible above the first card in both modes at desktop and phone width, one
  `h1`; a card's Mark read; Citizen Dashboard centred in Civic's top bar, gone in Everything, no
  overlap at 900-1100 px, on its own line on a phone). Mark all read steps removed from `river.spec.ts` (visitor) and
  `signin.spec.ts` (check 23); `smoke`, `modes` and `themes` specs read the hidden `h1` and the
  top-bar title; `revisions4.spec.ts` item 5 no longer expects the summary line; unit
  `ui/modes` (`viewTitle`, `topbarTitle`). Unit 588,
  e2e 107.
- 2026-10-23, UI revisions 4 items 2-5 (filter column): e2e `revisions4.spec.ts` items 2-5 (8
  tests: six rows then scroll with a hint, none at six, using stand-in circles added to the feed's
  answer; the title in both modes; Clear all compact and primary in both modes; no chips, the
  summary line stays; Clear all first in the phone chip row). `revisions.spec.ts` item 3 removed
  (chips gone), headings are the title's `h2` and the sections' `h3`, and the collapse test takes
  the circles' second list; `themes.spec.ts` checks Clear all's Civic colour instead of a chip's;
  `filterClear.spec.ts` counts the title before search.
- 2026-10-23, UI revisions 4 item 1 (multi-select circles): unit `feedScope` (several circles,
  "All" among them, an unknown one refuses the list), `ui/filters` (`toggleCircle`) and
  `ui/format` (one `circle` parameter per circle); API `feed.test.ts` (two circles are the union,
  AND a type; a bad or malformed circle is 400; 30 repeats still read as a list) and
  `signin.test.ts` (a member's two circles, and Mark all read with a list); new e2e
  `revisions4.spec.ts` item 1 (5 tests: union, type, toggle off and on, All shows every article;
  the URL, a link, opening an item and Back; keyboard; Civic keeps only the civic circle; the
  phone chip row). `river.spec.ts` turns News and ideas off before picking Soccer. Unit 587,
  API 150, e2e 92.
- 2026-10-22, UI revisions 3 items 1-2 (how a card opens): unit `ui/embed` rewritten; e2e
  `revisions3.spec.ts` items 1 and 2 (8 tests; the framed path uses a stand-in framing answer
  via `page.route`, new tabs are checked by their navigation request since fixtures.ts cuts
  them off); `revisions2.spec.ts` trimmed to the filter column, the wide reader (both at a
  sample's address) and the CSP; `revisions.spec.ts` item 1 is the reader at an address; Open ↗
  replaces opening items in `river`, `signin`, `themes` and `media` specs.
- 2026-10-22, UI revisions 3 item 5 (Clear all in the filter column): unit `ui/filters`; new e2e
  `filterClear.spec.ts` (2); `revisions.spec.ts` item 3 scopes "Clear all" to the chip row.
  Unit 583, e2e 88.
- 2026-10-22, UI revisions 3 item 4 (filter column scroll): new e2e `filterColumn.spec.ts` (a
  short window: the column scrolls on its own to its last control and keeps its place while the
  feed scrolls; a tall window: nothing to scroll). e2e 86.
- 2026-10-22, UI revisions 3 item 3 (River bar): new e2e `revisions3.spec.ts` measures the
  embedded view's bar on desktop and phone (width, the mark's tile centered vertically and
  horizontally, the mark filling at least 75% of it, label and link inside). e2e 84.
- 2026-10-22, UI revisions 2 (embedded view, wide reader, fixed filter column): unit
  `frameCheck` (X-Frame-Options and CSP frame-ancestors as browsers read them, CSP3 source
  matching against the River's origin, both recorded pages, and through the real guard: one GET,
  redirects followed, 404, non-HTML, download, unrecorded host, private address never asked, the
  10-minute and 1-minute caches; DERIVED variants of the recorded article); `ui/embed` (which
  URLs are Mastodon statuses, the plan for each item); `ui/csp` asserts `frame-src https:`. API
  `feed.test.ts`: `GET /items/{id}/frame` frames the recorded article, not the hub page, a sample
  or an unrecorded host; 404 and 400. New e2e `revisions2.spec.ts` (11 tests): the Mastodon embed
  (src, sandbox, referrerpolicy, title, bar, focus, frame size, axe), the bar and Back/Forward with
  scroll and filters, direct `/item/{id}`, a checked page framed (and not rechecked), a refusing
  page in the reader, a sample with no check, CSP with no violation while framing, phone; the
  filter column's box unchanged through the reader and "Opening…"; the reader spanning the feed
  and Coming up columns. Framed documents get a stand-in page via `page.route`, so nothing leaves
  loopback. Existing specs: "Open original" is "Open in new tab"; tests that opened Mastodon
  cards in the reader now expect the embedded view or use samples; the reader's video test serves
  its stored item without a URL so it opens in the reader; the scroll tests center the card
  first (Playwright's click had scrolled it). Unit 580, API 148 (fresh `db reset`), e2e 82.
- 2026-10-22, boost content: unit `boostContent` replays real recorded boosts from @w3c, @eff
  and @swf (posts, actors, a 401 actor plus Mastodon's lookup, embedded posts re-read where they
  live) and DERIVED variants (budget, deadline, not public, wrong host, reply, script, forged
  embedded text, foreign author, impostor actor or lookup); `ui/boost` covers `boostedPost()`
  (only `fetched` boosts show the original author). `fediverseAdapter` paging tests now expect one more `onPage` with the filled
  boosts; `mediaAdapters` PeerTube tests read a non-own share as a filled boost. e2e
  `river.spec.ts` checks a filled boost card and the reader (title, byline, boost line, Open
  original, axe); `following.spec.ts` sees both the filled and the plain boost line. Unit 558,
  API 145 (fresh `db reset`), e2e 71 (with main through #25). Locally the e2e ran on the preinstalled Chromium 1194 headless shell (mapped
  through `PLAYWRIGHT_BROWSERS_PATH`), since the sandbox can't download Playwright's own.
- 2026-10-21, Civic mode retheme (Civic Hub default theme): unit `ui/civicTheme` reads civic.css,
  checks the hub's values and that every text pair (body, heading, muted, link, danger on page,
  card and alt; filled buttons; chips and banners; each process pill on its 10% tint) is at least
  4.5:1, and that every key `processKey` returns has a color; `ui/format` covers `processKey`.
  e2e `themes.spec.ts`: Civic tokens and shadow updated; new "Civic mode wears the Civic Hub theme
  on every surface" (page, header, mode switch, sidebar, pills, active chip, cards and their
  process edge and pill, panel, focus ring, reader, phone; axe wcag2a/wcag2aa on the feed, the
  reader and a phone) attaches three screenshots to the report (reference copies in
  `docs/design/screenshots/`); "Everything mode keeps the Mosaic look" proves the fallbacks.
  `modes.spec.ts` civic primary is now `#2a4e84`. Unit 535, e2e 70.

- 2026-10-21, M12 brought up to date with main (after #17-#24): e2e `media.spec.ts` now checks
  the card's host (`card-host`) instead of the removed "Open on" link, and in the reader view
  "Open original" (href, new tab, noopener) plus the episode's `<audio>` and the PeerTube
  `<video>` (https src, `preload="none"`). Unit 530, API 145 (fresh `db reset`), e2e 68.

- 2026-10-21, identity error log: unit `identityErrorLog` checks `errorLogLine()`: a coded error
  (SQLSTATE 23505 with an email in its detail, ECONNREFUSED) logs name and code only; an uncoded
  configuration error logs its message on one line, capped at 300 characters.
- 2026-10-21, reader audio and video: unit `ui/csp` asserts `media-src 'self' https:`;
  `ui/format` covers safeMediaUrl (https only, no userinfo) and playableMedia; e2e
  `revisions.spec.ts` opens a recorded fediverse post with a video at `/item/{id}` and checks the
  `<video>` (https src, controls, `preload="none"`, accessible name, no media request before play,
  axe) and that cards have no player; `river.spec.ts` CSP test checks media-src.

- 2026-10-21, UI revisions 1 (item 7): unit `ui/groups`; e2e `revisions.spec.ts` grouped hub
  cards (one card per hub process on the first page, `data-group-size`, the lead's label, the
  disclosure lists the earlier updates without opening the reader, Enter on one opens it, group
  Mark read and Mark unread write every id); `river.spec.ts` Mark all read compares with the sum
  of `data-group-size`.

- 2026-10-21, UI revisions 1 (item 6): unit `plugins` (Coming up's intro for "view" and
  "followed", Everything's placement and reach, the API's keys now include `reach`); API `modes`
  (Everything has Coming up in date order, the same with filters on); e2e `revisions.spec.ts`
  (Everything panel right of the feed, sorted and upcoming, unchanged by a type filter; below the
  feed at 390 px; reader keeps `?mode=civic&type=civic` and shows the author); `modes.spec.ts`
  check 7 expects Coming up, not the Civic slots, in Everything.

- 2026-10-21, UI revisions 1 (item 1): API `feed` `GET /items/{id}` (equal to the feed's item,
  404 unknown, 400 malformed, 404 outside the follows or hidden); e2e `revisions.spec.ts` reader
  view (click opens `/item/{id}` beside the sidebar, reload loads it from the API, scroll restored
  by Back to River and browser Back, Forward reopens, Mark read/links/Sample keep their behavior,
  keyboard and focus return, axe, marks read, unknown item, phone width); `river.spec.ts` check 4
  revised (host in the footer, Open original's target and rel); read-state tests (visitor and
  member) open items in the reader instead of a new tab.

- 2026-10-21, UI revisions 1 (items 2-4): unit `feedScope` (several types, networks, refusals)
  and `ui/format` (list parsing and toggling, query string); API `feed` (type lists, `network`
  hubs/fediverse/both, `network=bluesky` is 400); e2e `revisions.spec.ts`: type pills (pressed,
  check mark, dark fill, URL, reload, deselect, keyboard, phone, no checkbox or select), active
  chips (four filters, each ✕, Clear all), Networks (order, each network, both, samples back when
  none) and collapsible sections.

- 2026-10-21, UI revisions 1 (items 5, 8): e2e `revisions.spec.ts`: Civic mode lists only All
  and the civic circle (desktop and phone) and falls back to All; the visitor's Sample River line
  sits above the header with a Sign in link and no sideways scroll. `modes.spec.ts`: a member sees
  no sample line.

- 2026-10-21, sanitize-html CJS fix: unit `sanitizeCjsLoad` loads sanitize-html in a child Node
  with `--no-experimental-require-module` (what Vercel's function loader does) and sanitizes one
  string. Fails with ERR_REQUIRE_ESM if htmlparser2 12 comes back. Unit 453.
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
