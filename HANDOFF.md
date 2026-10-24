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

## UI revisions 11, item 2: one source at a time — 2026-10-24

- Branch / PR: claude/source-filter → PR (self-merge when `ci` is green)
- Migrations: none.

**What it does.**
- **API.** `GET /api/feed` accepts `source` (a space id) and returns only that space's items. It
  combines with the other filters, and a malformed id gets 400 `bad_source`. Every response now
  lists the mode's sources (`sources`: id, name, network), sorted by name.
  `POST /api/read-state/all` takes `source` too, like the other filters.
- **Filters.** A "Source" section after Networks, in the filter column and the phone sheet. It's
  a dropdown with "All sources" first, then the sources grouped by network. The choice sits in
  the URL (`source=`), counts as a filter (so "Clear the filter" clears it) and names the source
  in the phone button's summary.
- **Cards.** A card's source name is a button that filters to that source and scrolls to the
  top. A boost's name stays text. The rest of the card still opens it.

Spec: `docs/spec/ui-revisions-11.md` item 2; details in DECISIONS.md.

**Keys.** None.

**Tests.**
- API: the sources list and the `source` filter (`feed.test.ts`); Mark all read by source
  (`signin.test.ts`).
- Unit (`filters.test.ts`): the source in the active count and summary.
- New e2e `revisions11.spec.ts`: the dropdown, a card's name, and the phone sheet.
- Older specs that clicked a card's source name to open the card now click its kind label.
  `filterColumn` scrolls to the dropdown as the column's last control.
- `npm run check`: 50 files, 701 tests passed; UI built. API feed and modes tests: 32 passed.

### Follow-ups
- None.

## UI revisions 11, item 1: no Following link in the top bar — 2026-10-24

- Branch / PR: claude/drop-following-link → PR (self-merge when `ci` is green)
- Migrations: none.

**What it does.** The top bar's "Following" text link is gone; it did what Follow does for a
member. The profile menu gains a "Following" item for members, which keeps the mode. Spec:
`docs/spec/ui-revisions-11.md` (item 2, the Source filter, follows in its own PR).

**Keys.** None.

**Tests.** `profile.spec.ts`: the menu lists My information, Following, Settings and Sign out,
and the bar has no Following link. `modes.spec.ts` opens Following from the menu, with Civic
kept. `npm run check`: 50 files, 700 tests passed; UI built. e2e (profile, modes, following,
revisions8): 21 passed.

### Follow-ups
- Item 2 (Source filter): its own PR.

## UI revisions 10: one filter button, narrowing gaps — 2026-10-24

- Branch / PR: claude/filter-button-gaps → PR (self-merge when `ci` is green)
- Migrations: none.

**What it does.**
- **One filter button.** The filter column's title and "Clear all" are replaced by one wide
  button under search. It reads "Filter your River" (open the sections and go to the first
  filter), then "Clear the filter" once any filter is on (clear all, keep the mode). The phone
  sheet is unchanged.
- **Narrowing gaps.** The gaps between columns narrow from 2rem to 0.5rem as the window nears the
  width where a column drops.

Spec: `docs/spec/ui-revisions-10.md`; details in DECISIONS.md.

**Keys.** None.

**Tests.**
- New e2e `revisions10.spec.ts`: the button in both modes, and the gaps at three and two columns.
- `filterClear.spec.ts`: rewritten for the button, including focus and the "go to filters" click.
- `revisions4` items 3-4: removed as superseded; the sheet tests stay.
- `revisions` and `themes`: read the button.
- `npm run check`: 48 files, 689 tests passed; UI built. The filter and layout e2e files (7
  files): 44 passed.

### Follow-ups
- None.

## UI revisions 9: a profile menu, My information, dark mode — 2026-10-24

- Branch / PR: claude/profile-menu-dark-mode → PR (self-merge when `ci` is green)
- Migrations: none.

**What it does.**
- **The profile menu.** A round profile button at the right of the top bar
  (`ui/src/components/ProfileMenu.tsx`) opens a menu:
  - for a member: My information, Settings and Sign out;
  - for a visitor: Settings and Sign in.
- **My information** says what a DID and a Mosaic DID are, and shows the member's DID with Copy.
  The DID and name are off the top bar.
- **Dark mode.** Settings has a "Dark mode" switch, and both themes have a dark version.
  - The choice is saved per browser; until there is one, the River follows the device.
  - `ui/public/color-scheme.js` applies it before the first paint.

Spec: `docs/spec/ui-revisions-9.md`; details in DECISIONS.md.

**Keys.** None (`localStorage` key `river:color-scheme`).

**Tests.**
- Unit:
  - `colorScheme` (the saved choice, the device fallback, blocked storage);
  - `mosaicTheme` (dark AA pairs);
  - `civicTheme`, which now checks light and dark separately.
- e2e:
  - new `profile.spec.ts`: a member's menu and My information with the DID, no DID in the bar,
    Sign out from the menu, a visitor's menu, the keyboard, a phone, dark on and off across a
    reload in both modes with axe, and the device's setting followed;
  - `signin.spec.ts` reads the DID through My information;
  - `revisions8` checks the profile button at the right edge.
- `npm run check`: 50 files, 700 tests passed; UI built.
- e2e: 136 passed. Check 37 needs `TEST_RECOVERY_KEY_FILE`, which this session doesn't have; it
  runs in CI.

### Follow-ups
- The Following page's header has no profile menu yet. Dark mode applies there.

## UI revisions 8: Coming up back, circle pills, the whole window — 2026-10-24

- Branch / PR: claude/layout-full-width → PR (self-merge when `ci` is green)
- Migrations: none.

**What it does.**
- **Coming up is back in Everything.** Its plugin read only the newest 500 followed items, and
  busy Bluesky, fediverse and RSS feeds had pushed the hub votes out of that window. The plugins
  now also get the newest dated items (`queryViewItems`). Everything keeps the column when
  nothing is coming up and says so.
- **Circles as pills.** The filter column's circles are wrapping pills like the content types,
  four rows and then scrolling.
- **The whole window.** On a desktop the page spans the window like Facebook's: filters against
  the left edge, Coming up against the right, the feed centred between. The reader is capped at
  66rem.

Spec: `docs/spec/ui-revisions-8.md`; details in DECISIONS.md.

**Keys.** None.

**Tests.**
- API `db/modes.test.ts`: Everything's Coming up still finds the Longmont vote under 520 newer
  posts. It fails on the old query.
- Unit `plugins.test.ts`: Everything's empty state.
- e2e:
  - new `revisions8.spec.ts`: Coming up shown; edges at 1920 and 1440; the 1100 layout; the top
    bar;
  - `revisions4` item 2 rewritten for pills;
  - `revisions2`'s reader check updated;
  - `themes` reads a content-type pill, since the first circle pill, All, starts pressed.
- `npm run check`: 48 files, 689 tests passed; UI built.
- API: 17 files, 162 tests passed.
- e2e: 130 passed. Check 37 needs `TEST_RECOVERY_KEY_FILE`, which this session doesn't have; it
  runs in CI.

### Follow-ups
- The Following page keeps its centred layout. Say if it should go edge to edge too.

## Deps: body-parser 1.20.9 for the npm audit failure — 2026-10-24

- Branch / PR: claude/body-parser-audit → PR (self-merge when `ci` is green)
- Migrations: none.

**What it does.** `npm audit fix` moves Express's `body-parser` from 1.20.8 to 1.20.9
(GHSA-27r3-jxmh-p828, high: a denial of service via trailing bytes after a compressed request
body). It is a lockfile-only change within Express's own range. `ci`'s
`npm audit --audit-level=high` failed on every branch without it.

**Keys.** None.

**Tests.** No test changes. `npm audit --audit-level=high`: 0 vulnerabilities (root and `ui/`).
`npm run check`: 48 files, 688 tests passed; UI built.

### Follow-ups
- None.

## UI revisions 7: a circles menu on each Following row — 2026-10-23

- Branch / PR: claude/following-circles-menu → PR (self-merge when `ci` is green)
- Migrations: none.

**What it does.** Each followed row on the Following page (and the River's phone Following tab)
gets a "Circles" menu button showing its circles as swatches with names
(`ui/src/components/CirclesMenu.tsx`). Its menu lists every circle with the row's checked. A click
adds or removes the row at once through `addToCircle` and `removeFromCircle`; a refused save is
undone and its sentence shown. "New circle…" makes a circle (next unused color) with the row in
it. The menu closes with Escape, a click outside or Done, and focus goes back to the button.
Below 56rem it's a small bottom sheet. The Circles panel's editor is unchanged. Spec:
`docs/spec/ui-revisions-7.md`; details in DECISIONS.md.

**Keys.** None.

**Tests.** e2e `circlesMenu.spec.ts` (5 tests: add and remove with every circle listed, the row
changing before a held save and undone when it's refused, Escape and a click outside, New
circle… and a taken name, keyboard only, a 390px phone sheet with axe). `following.spec.ts`
reads the row's circles from the button. Unit `ui/following` (`toggleId`, `nextCircleColor`).
`npm run check`: 48 files, 688 tests passed; UI built. e2e: 124 passed; check 37 needs
`TEST_RECOVERY_KEY_FILE`, which this session doesn't have (it runs in CI).

### Follow-ups
- None.

## Deps: zod override for the npm audit failure — 2026-10-23

- Branch / PR: claude/zod-audit-override → PR (self-merge when `ci` is green)
- Migrations: none.

**What it does.** Overrides `zod` to `^4.6.6` under `@vercel/cli-config`, which pins 4.1.11
(GHSA-mrhx-c7xc-m3w5, high). `ci`'s `npm audit --audit-level=high` failed on every branch
without it. Details in DECISIONS.md.

**Keys.** None.

**Tests.** No test changes. `npm audit --audit-level=high`: 0 vulnerabilities (root and `ui/`).
`npm run check`: 48 files, 685 tests passed; UI built.

### Follow-ups
- Drop the override when `@vercel/cli-config` ships a fixed `zod`.

## Bluesky reading, step 4: Import from Bluesky and the refresh rotation — 2026-10-23

- Branch / PR: claude/bluesky-import → PR (self-merge after ADR-009's PR and the two before it)
- Migrations: none.

**What it does.** The Following page gets "Import from Bluesky" (`ui/src/components/ImportBluesky.tsx`).
A member types a handle; `POST /api/follow/bluesky/preview` lists who it follows
(`app.bsky.graph.getFollows`, 100 a page, at most 10 pages) with a count and the first 12 names.
The member picks one circle (or none), and `POST /api/follow/bluesky/import` follows them all:
spaces keyed by DID, in bulk, never twice. Accounts that hide from signed-out readers are left out
and counted. Each feed open now refreshes at most 12 Bluesky spaces, a rotating subset: most
overdue first (recent posters have shorter intervals), with shares for just-imported accounts
and the longest-waiting ones (`src/river/feed/rotation.ts`; design in DECISIONS.md).

**Keys.** None.

**Tests.** Unit `bluesky/follows` (paging, the 1,000 cap, a failing page, refusals),
`blueskyRotation` (intervals, cap, rotation, the new-account share), `ui/following`
(sentences); API `blueskyImport.test.ts` (members only, preview, import into a circle, re-import
adds nothing, the feed's capped refresh, errors); e2e `bluesky.spec.ts` import test. New
recordings: `@eff.org`'s profile, DID document and three pages of follows. Counts in TESTING.md.

### Follow-ups
- The spec review found that ordering by recency alone starved all but the 12 busiest accounts;
  fixed (overdue order plus a round-robin share), with a simulation test of 300 accounts.
- Importing again later adds accounts followed since; unfollows on Bluesky aren't mirrored (an
  import only adds).

## Bluesky reading, step 3: the Bluesky network and its cards — 2026-10-23

- Branch / PR: claude/bluesky-network → PR (self-merge after ADR-009's PR and the adapter PR)
- Migrations: none.

**What it does.** "Bluesky" joins the Networks filter (`network=bluesky`, adapter `atproto`).
Bluesky posts stay in the feed like fediverse posts: no framing check, the body opens nothing,
"Open ↗" opens the post on bsky.app. Reposts say "reposted". `GET /api/feed` returns a Bluesky
item's link card and quoted post as `embed`, and cards draw them (`ui/src/components/PostEmbed.tsx`).

**Keys.** None.

**Tests.** New e2e `bluesky.spec.ts` (sign up, follow `@bsky.app` by handle with its preview,
filter by Bluesky, Open ↗, reposted, a quote and a link card, axe); API `bluesky.test.ts`
`network=bluesky` with embeds; unit `feedScope`, `ui/embed`, `ui/boost`, `ui/format`; the
Networks pills in `revisions` and `revisions6` specs. Counts in TESTING.md.

### Follow-ups
- The reader view (reached only from an item's own address) doesn't draw link cards or quotes.

## Bluesky reading, step 2: the adapter — 2026-10-23

- Branch / PR: claude/bluesky-adapter → PR (self-merge after ADR-009's PR merges)
- Migrations: none (`atproto` was already a `spaces.adapter` value).

**What it does.** Adds `src/river/adapters/bluesky/` (ADR-009, `docs/spec/bluesky-1.md` item
2). The follow box takes `@handle`, `name.bsky.social`, a bsky.app profile URL, a DID or an
`at://` URI; it resolves the handle (AppView, then the handle's well-known document), checks the
DID document names it back, and previews name, avatar and bio. Spaces are keyed by DID
(`at://{did}`). Refresh reads `getAuthorFeed` (no replies): posts, photos with alt text,
galleries, video thumbnails, link cards and quotes (kept in `raw.embed`), and reposts as boost
cards under the original author. The Following page groups Bluesky accounts under "Bluesky".

**Keys.** None.

**Tests.** Unit `tests/unit/bluesky/` (input, map, adapter) on new recordings; API
`bluesky.test.ts`; `media.test.ts` expects the preview's new `description`. `npm run check`:
45 files, 664 tests. API: 160 passed. e2e: 118 passed, with `revisions4`'s hub card scrolled into
view first (it failed on main after about 11:30 UTC; fixed on the ADR branch).

### Follow-ups
- The spec review found that malformed percent-encoding (`did:%`) gave a 500; fixed in both the
  Bluesky and fediverse input parsers, with unit and API tests.
- The feed doesn't return link cards and quotes yet, and Bluesky cards still get the framing
  check: the next PR (network filter and cards) does both.
- "Import from Bluesky" and the refresh cap for large lists come after.

## Bluesky reading, step 1: ADR-009 — 2026-10-23

- Branch / PR: claude/hopeful-planck-thcj8d → PR (needs-adam: a new ADR and new outbound hosts)
- Migrations: none.

**What it does.** Adds `decisions/009-reading-bluesky.md` (Proposed), the first Bluesky step of
Adam's Phase 2 plan (2026-10-23). It names the new outbound hosts and why: Bluesky's public
AppView (`public.api.bsky.app`: resolveHandle, getProfile, getAuthorFeed, getFollows), the PLC
directory for `did:plc`, a `did:web`'s own domain, and a handle's `/.well-known/atproto-did`.
All through the fetch guard, unauthenticated, public data only. Records Bluesky's published rate
limits (none numeric for the AppView) and the River's own caps.

**Keys.** None.

**Tests.** None (docs only).

### Follow-ups
- The adapter, the Bluesky network filter and "Import from Bluesky" follow in their own PRs,
  merged only after this one.

## UI revisions 6: the mobile filter sheet — 2026-10-23

- Branch / PR: claude/dreamy-ride-w3nd4z (restarted from main after #34) → PR (self-merge; not
  needs-adam)
- Migrations: none.

**What it does.** Adds `docs/spec/ui-revisions-6.md` (sent as "ui-revisions-5.md", which was
taken; logged under "Spec questions"). Below 56rem the chip strip is gone: one full-width
"Filter your River" button shows the count and a one-line summary of what's on, and opens a
bottom sheet (`FilterSheet` in `ui/src/components/Filters.tsx`, on `<dialog>` + `showModal()`)
with the title, search, Clear all and the three sections as wrapping pills. Toggles apply at
once; "Show results", Escape, the backdrop, the handle (tap or swipe down) and Back close it
and keep the selections. The desktop is unchanged.

**Keys.** None.

**Tests.** New e2e `revisions6.spec.ts` (11 tests); phone steps in `revisions`, `revisions4`,
`river` and `modes` specs moved to the sheet; unit `ui/filters`. `npm run check`: 42 files, 590 tests. e2e: 118
passed (vite preview, as CI).

### Follow-ups
- "Show N items" would need a count from the API; the footer says "Show results" for now.

## UI revisions 5: the feed starts with an item; "Citizen Dashboard" in Civic — 2026-10-23

- Branch / PR: claude/dreamy-ride-w3nd4z (restarted from main after #33) → #34 (merged)
- Migrations: none.

**What it does.** Adds `docs/spec/ui-revisions-5.md`. The middle column loses its visible title
("Everything" / "Civic"), the "N unread · newest first" line and "Mark all read", so the first
card tops the column; the view's `h1` stays, visually hidden. Civic mode shows "Citizen
Dashboard" centred in the top bar (a three-column grid, so it never overlaps the switch or the
actions; its own line on a phone), and the window title follows.
Cards keep their unread dot and Mark read / Mark unread.

**Keys.** None.

**Tests.** New e2e `revisions5.spec.ts` (8 tests); `river`, `signin`, `smoke`, `modes`, `themes`
and `revisions4` specs updated. `npm run check`: 42 files, 588 tests. e2e: 106 passed, then `revisions5` (8) after the
narrow-desktop fix.

### Follow-ups
- `POST /api/read-state/all` has no caller in the UI now; remove it (and its API tests) if Adam
  agrees.

## UI revisions 4, items 2-5: the filter column — 2026-10-23

- Branch / PR: claude/dreamy-ride-w3nd4z (restarted from main after #32) → #33 (merged)
- Migrations: none.

**What it does.** The filter column opens with the title "Filter your River" (`h2`; the
sections' headings are now `h3`). "All" sits above the circle list, which shows six circles and
scrolls inside the section after that, with "Scroll for more circles" below it while it
overflows. "Clear all" is a compact outlined button in the theme's primary colour (one line,
about 25 px tall), below search, and first in the phone's chip row. The active-filter chips
above the feed (`ActiveFilters`) and their CSS are removed; the unread count and sort line stay.

**Keys.** None.

**Tests.** e2e `revisions4.spec.ts` items 2-5 (8 tests); `revisions`, `themes` and `filterClear`
specs updated. `npm run check`: 42 files, 587 tests. e2e: 99 passed (vite preview, as CI).

### Follow-ups
- The six-circle checks use stand-in circles added to the feed's answer (visitors have five); a
  member with seven real circles would prove the same with more setup.

## UI revisions 4, item 1: circles are multi-select — 2026-10-23

- Branch / PR: claude/dreamy-ride-w3nd4z → #32 (merged)
- Migrations: none.

**What it does.** Adds `docs/spec/ui-revisions-4.md` (Adam's five items). Circles toggle like the
content-type pills (check mark, `aria-pressed`), several at once; "All" clears them. The feed
shows (any selected circle) AND types AND networks AND search. Each circle is its own `circle`
parameter in the page URL, `GET /api/feed` and the "Mark all read" body (a string or a list), so
a one-circle link still works and circle names may hold commas. Switching to Civic keeps only
the civic circle. The active-filter chips show one chip per circle until item 5 removes them.

**Keys.** None.

**Tests.** Unit `feedScope`, `ui/filters`, `ui/format`; API `feed` and `signin`; new e2e
`revisions4.spec.ts` item 1 (5 tests); `river.spec.ts` adjusted. `npm run check`: 42 files, 587
tests. API: 150 passed. e2e: 92 passed (vite preview, as CI).

### Follow-ups
- Items 2-5 (six circles then scroll, the title, a compact Clear all, no chips) come in the next PR.
- A link that names a non-civic circle in Civic mode still shows nothing, with the circle
  unlisted (as before this change); "Clear all" clears it.

## UI revisions 3, items 1-2: fediverse posts stay in the feed; other items framed or in a new tab — 2026-10-22

- Branch / PR: claude/inspiring-johnson-bzl1yf → PR (needs-adam: ADR-008 amended)
- Migrations: none.

**What it does.** Mastodon `/embed` pages are no longer framed. Every live card's footer has
"Open ↗", the original in a new tab (`rel="noopener noreferrer"`); a fediverse card's body opens
nothing. Other live cards (hubs, feeds) ask `GET /api/items/{id}/frame` as they come into view
(`ui/src/lib/useFrameAnswers.ts`), so a click already knows: an allowed page opens framed beside
the River bar at `/item/{id}`; a refused one opens in a new tab inside the click, and the River
stays on the feed. A click before the answer (or an item's address) shows "Open on {host} ↗"
beside the bar, which becomes the frame if the answer allows it. No click opens the reader; it
shows only at a sample's (or a missing item's) address. Cards carry `data-open`
(`none | pending | frame | tab`).

**Merge rule.** `needs-adam`: ADR-008 points 1 (checks run ahead of time, for cards in view), 3
(fediverse never framed) and 6 (what a click does) are amended; it is still Proposed.

**Keys.** None.

**Tests.** Unit `ui/embed` rewritten (plan and card open mode). New e2e in `revisions3.spec.ts`
items 1 and 2 (8 tests: a fediverse body click does nothing; Open ↗ on every live card, none on
samples, marks read; the check runs once a card is in view and a refused card opens a new tab
while the River stays; an allowed page frames, with Back, the bar, scroll and filters; a pending
click shows Open on {host}, refused and allowed endings; addresses; keyboard). No recorded
non-fediverse page allows framing, so the framed path is driven by a stand-in answer from
`page.route` (the API test proves the server's real answer). `revisions2.spec.ts` keeps items 1
and 3 at a sample's address and the CSP; `revisions.spec.ts` item 1 now covers the reader at an
address; `river`, `signin`, `themes` and `media` specs use Open ↗ where they opened items.
`npm run check`: 41 files, 581 tests. e2e: 83 passed on the dev server.

### Follow-ups
- The reader's audio and video players are no longer reached from cards (logged under "Spec
  questions"); Adam may want players on media cards.
- The check still matches `RIVER_PUBLIC_ORIGIN`, not the asking instance's host (from #27).
## UI revisions 3, item 5: "Clear all" at the top of the filter column — 2026-10-22

- Branch / PR: claude/filter-clear-all → PR (self-merge; not needs-adam)
- Migrations: none.

**What it does.** The desktop filter column gets a "Clear all" button just below search. It shows
only when search, a circle, a content type or a network is on, and one click resets those four
(everything shows again); the mode stays, since it is the header's switch, not a filter (logged
in `DECISIONS.md`). Focus then moves to the search field, because the button goes away. The
"Clear all" above the feed (ui-revisions-1 item 3) stays and shares the reset
(`ui/src/lib/filters.ts`: `CLEARED`, `hasActiveFilter`, and `FilterState`, which moved there so
the server's typecheck can read it).

**Keys.** None.

**Tests.** Unit `ui/filters` (when it shows; what it resets; never the mode). New e2e
`filterClear.spec.ts` (hidden with nothing on, below search and above Circles with four filters
on, one click clears all four, focus to search; a lone search shows it, Enter works, the Civic
mode and theme stay). `revisions.spec.ts` item 3 now scopes its "Clear all" to the chip row.
`npm run check`: 42 files, 583 tests.

### Follow-ups
- None.

## UI revisions 3, item 4: the filter column scrolls on its own — 2026-10-22

- Branch / PR: claude/filter-column-scroll → PR (self-merge; not needs-adam)
- Migrations: none.

**What it does.** On a desktop the left filter column (`.filter-column`, the sticky wrapper around
the sidebar) is capped at the window's height below the header and scrolls by itself
(`overflow-y: auto`, `overscroll-behavior: contain`, so scrolling it never scrolls the feed). It
stays where it is while the feed scrolls, as before. A small inline padding, taken back by a
negative margin, keeps the sidebar's shadow from being clipped. Phones are unchanged (the column
isn't shown there).

**Keys.** None.

**Tests.** New e2e `filterColumn.spec.ts`: in a 480 px window the column is scrollable, fits the
window once stuck, keeps its place while the feed scrolls, scrolls by itself (the window doesn't)
to its last control, which then works; in a 1400 px window it has nothing to scroll.
`npm run check`: 41 files, 580 tests. e2e `filterColumn`, `revisions`, `revisions2`: 33 passed.

### Follow-ups
- None.

## UI revisions 3, item 3: a narrower River bar, the mark centered — 2026-10-22

- Branch / PR: claude/river-bar-narrow → PR (self-merge; not needs-adam)
- Migrations: none.

**What it does.** Writes Adam's UI revisions 3 into `docs/spec/ui-revisions-3.md` (items 1-2
follow in a `needs-adam` PR, items 4 and 5 in their own PRs). The embedded view's bar is
narrower (3.25rem desktop, 2.75rem phone; tokens in `theme.css`). The back button is a
three-row grid, so the Mosaic mark sits in the bar's exact vertical center with "River" below
it, and the mark fills 85% of its white tile. The "Open in new tab" link is pinned to the bar's
foot, so it doesn't push the mark off center.

**Keys.** None.

**Tests.** New e2e `revisions3.spec.ts` item 3 (desktop and phone: bar width, mark centered within
2 px, mark at least 75% of its tile, label and link inside the bar). `npm run check`: 41 files,
580 tests, UI build OK. e2e `revisions2` and `revisions3`: 13 passed.

### Follow-ups
- None.

## UI revisions 2: items open where they live, in an embedded view; the reader is wide — 2026-10-22

- Branch / PR: claude/inspiring-johnson-bzl1yf → PR (needs-adam: `vercel.json` CSP, ADR-008, a
  new outbound request)
- Migrations: none.

**What it does.** Adam's UI revisions 2 are written down in `docs/spec/ui-revisions-2.md`.
Clicking a card now replaces the River with an embedded view (after citizen-dashboard's
ExternalView): a narrow bar with the Mosaic mark and "River" (back to the feed at the same scroll
position and filters) and the source in a sandboxed iframe, at `/item/{id}` so Back and Forward
work. Mastodon posts frame `{status url}/embed` at once. Any other live page is checked first by
`GET /api/items/{id}/frame`, which reads the stored item's page once through the fetch guard and
frames it only if its `X-Frame-Options` and CSP `frame-ancestors` allow the River
(`src/river/frame/`); otherwise, and for samples, the item opens in the reader, which now spans
the feed's and Coming up's columns and says "Open in new tab". The grid no longer changes while
reading and the page keeps a scrollbar gutter, so the filter column never moves. The CSP gains
`frame-src https:`.

**Merge rule.** `needs-adam`: `vercel.json` changes, ADR-008 is new (Proposed), and the check is a
new outbound request (constraint 3). Not merged.

**Keys.** None (the check matches against `RIVER_PUBLIC_ORIGIN`). `npm run record-fixtures --
--frames` records the check's pages.

**Tests.** Unit `frameCheck` and `ui/embed`, `ui/csp`; API frame endpoint; e2e
`revisions2.spec.ts` (11) and updates to the specs that opened Mastodon cards. `npm run check`:
41 files, 580 tests, UI build OK. API 148/148 after a fresh `db reset`. e2e 82/82 on the dev
server; `revisions2` and `river` specs also pass against `vite preview` (as CI runs them).

### Follow-ups
- Which fediverse posts are Mastodon's is read from the URL shape; a non-Mastodon server with
  the same shape would show its own `/embed` answer. Checking the host's NodeInfo would settle it
  (ADR-008 Consequences).
- The reader's players for Mastodon videos are no longer reachable from a card (those open in the
  embed); PeerTube and podcast items still play in the reader.
- Where the fallback reader sits is logged under "Spec questions" in `DECISIONS.md` (River layout,
  not beside the bar); Adam may prefer the other reading.

## Boost cards: the boosted post, its author and avatar, fetched at refresh — 2026-10-22

- Branch / PR: claude/boost-cards-original-content-04hthy → #26 (self-merge at Adam's direct
  request; see below)
- Migrations: none (`boost_of` is jsonb; `author` inside it is new data, not a new column).

**What it does.** Boosts no longer show the empty "The boosted post opens where it lives" card.
During a fediverse refresh, `fetchNew` fills each bare Announce through the fetch guard:
the boosted object, then its author (actor document, or Mastodon's account lookup when the actor
answers 401/403), at most 20 requests per source per refresh, a budget PeerTube's own videos now
share (`src/river/adapters/fediverse/boostContent.ts`). The item keeps the Announce's id, time
and booster; it takes the post's kind, text, media and URL, and `boost_of.author` holds the
original author. Cards and the reader view show the original author's name and avatar under a
small "{booster} boosted" line; the reader's title is "Post from {author}" (or the post's own
title). A post the Announce embeds is re-read from its own host too; only a boost read that way
gets `boost_of.fetched` and the original-author layout, so a server can't put words under
someone else's name. A boost that isn't fetched keeps today's card. No boost starts more than 8 s
into the fill (the refresh's claim is 20 s). Spec 4.3 "Map" says so now.

**Merge rule.** CLAUDE.md asks for `needs-adam` when a PR adds an outbound call. These requests
were already allowed by ADR-001 item 1 (hosts sources point to for actors and boosted objects),
and Adam asked for exactly this change and to merge it himself once `ci` was green, so it was
self-merged with that noted on the PR.

**Keys.** None.

**Tests.** New unit `boostContent` (real recorded boosts: text, image with alt, a mastodon.social
author through the lookup after a 401, a Mastodon self-boost, @swf's embedded posts re-read where
they live, an embedded post that can't be re-read, an unreachable host keeping the plain card,
exactly 20 requests on the real w3c refresh; DERIVED: past the budget, past the deadline, not
public, served from another host, a public reply, `<script>` sanitized, forged embedded text
replaced or left unattributed, an author on another host, an actor or Mastodon lookup naming
someone else) and `ui/boost`; paging and PeerTube tests updated for the fill. New fixtures: 28
real responses from w3c.social, mastodon.social and socialwebfoundation.org
(`tests/fixtures/http/README.md`). e2e: `river.spec.ts` checks a filled boost card and its
reader view. Counts are in `TESTING.md`.

### Follow-ups
- A boost left plain (budget spent, or a host down at that moment) is never retried: the next
  refresh stops at it as already known. A later pass could re-fill stored plain boosts with
  leftover budget.
- Mastodon REST-fallback reblogs are not re-read from their host, so they keep the booster's
  card (with the text the REST API gave). Filling them would cost one request each from the
  same budget.
- On a PeerTube channel, a share that turns out not to be the channel's own video is fetched twice
  (once by the PeerTube path, once by the fill). Rare and within the budget; left as is.

## Civic mode retheme: the Civic Hub's default theme — 2026-10-21

- Branch / PR: claude/civic-mode-theme-redesign-c1vu1d → PR (self-merge; not needs-adam)
- Migrations: none.

**What it does.** Civic mode now wears the Civic Hub's default theme (Adam, 2026-10-21; source
and values in DECISIONS.md): navy buttons, links and selected pills, terracotta accent, ink text
on warm paper, Libre Franklin and Inter, the hub's radii, shadows and focus ring, and its status
colors. Civic cards and the reader carry `data-process` (`processKey()` in `ui/src/lib/format.ts`)
and wear the hub's process-type color as a 4px left edge and as the label pill (hue on a 10%
tint). Tokens only Civic has are read with a Mosaic fallback, so Everything mode is unchanged
(`mosaic.css` untouched). Screenshots: `docs/design/screenshots/civic-*.png`.

**Keys.** None. New Civic-only CSS tokens are listed in civic.css's header.

**Tests.** Unit `ui/civicTheme` (hub values; AA for every text pair and process pill),
`ui/format` (`processKey`); e2e `themes.spec.ts` (every Civic surface, axe AA, screenshots;
Everything unchanged), `modes.spec.ts` (civic primary). `npm run check`: 37 files, 535 passed;
e2e: 70 passed.

### Follow-ups
- The hub's warning text (`#946c18` on `#fdf4d6`, 4.3:1) fails AA, so the deadline chip uses ink
  text with a warning edge. If the hub darkens its warning text, the River can match it.
- The identity host's server-rendered pages keep their own look; retheme them separately if wanted.

## Identity host: configuration errors say what failed in the log — 2026-10-21

- Branch / PR: claude/identity-error-message → PR (self-merge; not needs-adam)
- Migrations: none.

**What it does.** Production `GET /authorize` logged only "identity: GET /authorize failed: Error".
The identity error handler now logs an error's message when the error has no code (the
configuration errors from `env.ts`, `db/pool.ts` and `identity/config.ts`, which name a setting),
on one line and capped at 300 characters. An error with a code (a database SQLSTATE, or a driver
or system code such as ECONNREFUSED) still logs its name and code only, so database messages and
details never reach the log. The line comes from `errorLogLine()` in `src/identity/routes.ts`.

**Keys.** None.

**Tests.** Unit `identityErrorLog` (a config error's message logged; a database error's message
and detail withheld; coded system errors withheld; long messages capped; non-errors). `npm run
check`: 465 passed; API `identity`: 14 passed.

### Follow-ups
- Read the next production log line for `GET /authorize`; it should now name the failing setting.
## Reader view plays https audio and video (CSP media-src) — 2026-10-21

- Branch / PR: claude/eloquent-newton-v3ftlr → media PR (needs-adam: `vercel.json` CSP)
- Migrations: none.

**What it does.** Adds `media-src 'self' https:` to the River's CSP in `vercel.json` (Vite dev and
preview read it from there). The reader view plays an item's https audio and video in place with
native controls and `preload="none"`, so nothing loads until play; other media still says where it
plays. Cards don't get players.

**Keys.** None.

**Tests.** Unit `ui/csp` (media-src), `ui/format` (safeMediaUrl, playableMedia); e2e
`revisions.spec.ts` (a live fediverse video in the reader: https src, controls, preload none,
labelled, no media request before play, axe; no players on cards); `river.spec.ts` CSP check
includes media-src.

### Follow-ups
- Adam merges (CSP change). Spec Appendix B and 4.8 wording proposed in DECISIONS.md.

## UI revisions 1, item 7: related hub cards grouped — 2026-10-21

- Branch / PR: claude/eloquent-newton-v3ftlr → PR 5 of the UI revisions series (self-merge)
- Migrations: none.

**What it does.** Hub activities about the same process or meeting (same space and stream key)
show as one card: the latest leads with its status, the others fold under "N earlier updates"
(a disclosure listing each with its label and time; each opens in the reader). Mark read/unread
and opening the card cover the whole group. Grouping is in `ui/src/lib/groups.ts`, on the loaded
items; the API is unchanged. This completes `docs/spec/ui-revisions-1.md`.

**Keys.** None.

**Tests.** Unit `ui/groups` (folding, order, no grouping across spaces, without a stream or
outside hubs); e2e `revisions.spec.ts` item 7 (one card per process, lead's status, earlier
updates listed and opened from the keyboard, group Mark read/unread); `river.spec.ts` counts
folded items for Mark all read.

### Follow-ups
- None from the revisions list.

## UI revisions 1, item 6: Coming up in Everything — 2026-10-21

- Branch / PR: claude/eloquent-newton-v3ftlr → PR 4 of the UI revisions series (self-merge)
- Migrations: none.

**What it does.** Everything mode gets a right-hand "Coming up" column: up to five upcoming
deadlines and event starts across everything followed, soonest first, unaffected by circle,
type, network or search. On a phone it sits below the feed. Modes gained `pluginReach`; plugins
get `reach` in their API. Also from the reader view's review: the feed now stays mounted (hidden)
while an item is open, so Back restores the exact scroll position even while images load, and
tests now check the author and the kept query string.

**Keys.** None.

**Tests.** Unit `plugins` (intro per reach, Everything's placement); API `modes` (Everything's
panel, unchanged by filters); e2e `revisions.spec.ts` item 6 (desktop column, date order, filter,
phone order) and the reader's query string; `modes.spec.ts` updated for Everything's panel.

### Follow-ups
- None.

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
## M12 Real media (stretch): PeerTube channels, an RSS/Atom/podcast adapter — 2026-10-21

- Branch / PR: claude/m12-media → PR, **needs-adam**: a migration that changes an existing
  column's CHECK (`spaces.adapter` gains `rss`), a drafted ADR (ADR-007, Proposed, which amends
  ADR-001's host list), and a new kind of outside data source (feeds; new outbound requests: feed
  links a page names, and a PeerTube channel's Video objects). No auth, session, `.github/`,
  `vercel.json`, CLAUDE.md, fetch guard, sanitizer allowlist, keys, recovery or `seed.sql` change.
- Migrations: `20261021200000_rss_adapter.sql`.

**What it does.** PeerTube channels follow through the fediverse adapter by handle or URL and
read as `video` spaces ("PeerTube channel"): the channel's outbox announces its own videos by
IRI, so for PeerTube spaces those Videos are fetched (at most 20 per refresh) and stored as
`video` items with title, length (`duration`), thumbnail (widest `icon`), watch page and file
(top-level or the HLS playlist's), keyed by the Announce. A new `rss` adapter (last in the
registry) follows RSS 2.0, RSS 1.0 and Atom feeds and podcasts by feed URL or by a page's
`<link rel="alternate">`: audio enclosures make `podcast` items with `itunes:duration`, video
enclosures `video`, others `article` or `post`; HTML through the sanitizer, no email address kept
from authors, ETag/304 on refresh, newest 50 from the last 90 days. Its XML reader is in the repo,
lenient, and refuses entity declarations. The follow box (and seed resolve) now tries each adapter
that takes an address in turn. Following groups "Feeds and podcasts". No real seed was added;
DECISIONS.md proposes three for Adam.

**Keys.** None. Adapter value `rss`; `npm run record-fixtures -- --media <address>`;
`scripts/synthetic-media-fixtures.ts`.

**Tests.** Fixtures are SYNTHETIC (`tests/fixtures/http/synthetic-tube.example`,
`synthetic-podcast.example`): this sandbox's egress refused every PeerTube and podcast host tried,
so they are written to the published formats on reserved `.example` hosts and labelled (TESTING.md,
fixtures README). `npm run check`: Test Files 33 passed (33), Tests 516 passed (516), UI built.
`npm run test:api` (both dev servers, fresh `db reset`): Test Files 15 passed (15), Tests 141
passed (141). `npm run test:e2e` (fresh `db reset`): 48 passed. New: unit `rssFeed`,
`mediaAdapters`, additions to `fediverseMap`, `adapterRegistry`, `followResolve`; API `media`;
e2e `media` (follows the podcast by home page and the channel by handle; cards show kind, "42 min"
/ "4:33" and "Open on {host}").

### Follow-ups
- Adam: review ADR-007 and the migration (needs-adam); pick real seeds from DECISIONS.md
  ("Proposed real media seeds"), record them with `--media` from a machine that can reach them,
  check PeerTube's outbox order and the feed's size (the guard caps bodies at 2 MB), then retire
  the synthetic fixtures.
- Feeds over 2 MB (long-running podcasts) can't be read; raising the cap is a fetch guard change.
- No inline player: cards link out ("Open on {host}"); the audio/video file URL is stored in
  `media` for a later player.
- Spec questions logged: section 5 still lists RSS as out of scope; PeerTube channel category;
  thumbnails in `media`; PeerTube videos fetched at refresh; PeerTube outbox order.

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
