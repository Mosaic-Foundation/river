# UI revisions 1

Decided by Adam on 2026-10-21. These revise the River UI described in `river-v1.md` (F1, F4, F5,
F9, 4.7). Where they differ from `river-v1.md`, this file wins. Each item ships with Playwright
tests; the checks below are what they prove. All of it keeps to the Mosaic and Civic theme
tokens, keyboard access and labels on every control.

1. **Reader view.** Clicking anywhere on a card opens the item inside the River at its own URL,
   `/item/{id}` (the feed's query string is kept, so the mode and filters survive). The reader
   shows the full sanitized content, media, author and source, and keeps the left sidebar. It
   has a "Back to River" control and an "Open original" link (new tab,
   `rel="noopener noreferrer"`; live items only). Card footers drop "Open on …" and show only the
   source host (e.g. "mastodon.social"). Links, buttons and Mark read inside a card keep their own
   behavior. The reader uses the stored item only: no new outside fetch. Audio and video from
   https sources play in the reader, straight from their source, loading only when played (Adam,
   2026-10-21; the CSP gains `media-src 'self' https:`). Cards show no player.
   - Checks: a click on a card's text opens `/item/{id}` with the item's content, author and
     source; the sidebar is still visible; "Back to River" and the browser's Back both return to
     the feed at the same scroll position; "Open original" has `target="_blank"` and `rel`
     containing `noopener` and `noreferrer`; a card footer shows the host and no "Open on" link;
     clicking Mark read or a link inside a card doesn't open the reader; loading `/item/{id}`
     directly shows the item; a card opens from the keyboard; opening an item marks it read.
2. **Content type as toggle pills.** Each type is a pill: click selects it (dark fill and a check
   mark), click again deselects it. Several can be on at once; none means All. No checkboxes.
   - Checks: two types selected show only items of those kinds, with `aria-pressed="true"` and a
     check mark on each; deselecting both shows every kind; the URL keeps the selection
     (`type=posts,videos`); no checkbox inputs on the page.
3. **Active filter chips.** Above the feed, one chip per active filter (circle, each content
   type, each network, search text), each with an ✕ that removes it, plus "Clear all" when any
   filter is active.
   - Checks: with a circle, a type, a network and a search on, four chips show; each ✕ removes
     its filter; "Clear all" removes every filter; no chips and no "Clear all" when none is on.
4. **Networks.** A "Networks" section in the left sidebar below Content type: Civic Hubs and
   Fediverse (Mastodon and compatible), toggle pills that work like content types (none means
   all). Circles, Content type and Networks are each collapsible.
   - Checks: Fediverse alone shows only fediverse items; Civic Hubs alone only hub items; both on
     shows both (sample entries belong to no network, so any network filter hides them); each
     section collapses and expands from its heading button with `aria-expanded`.
5. **Civic mode shows only civic sources.** Civic mode lists only the Civic circle (the
   `role = civic` circle) and shows the civic plugins; the other circles are hidden there.
   - Checks: in Civic mode the sidebar lists All and the Civic circle only; in Everything every
     circle shows; switching to Civic from another circle falls back to All.
6. **Coming up in Everything.** Everything mode gets a right-hand column, "Coming up": upcoming
   dates (events and deadlines) across all followed sources, soonest first, whatever the filters.
   On phone width it sits below the feed.
   - Checks: Everything shows the Coming up column at desktop width with entries in date order;
     a content-type filter doesn't empty it; at phone width it comes after the feed.
7. **Group related hub cards.** Hub activities about the same process or meeting (the same hub
   stream) show as one card: the latest activity leads, the others fold into it ("2 earlier
   updates", expandable).
   - Checks: a hub stream with several loaded activities shows one card; its earlier updates are
     listed when expanded; Mark read on the group marks every item in it.
8. **Sample River line.** Signed-out visitors keep the sample River, with one line at the top:
   "Sample River · Sign in to make it your own" ("Sign in" links to sign-in).
   - Checks: a visitor sees the line and its Sign in link; a signed-in member doesn't.
