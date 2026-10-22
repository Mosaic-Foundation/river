# UI revisions 3

Decided by Adam on 2026-10-22. These revise how an item opens (`ui-revisions-2.md` item 2, which
revised `ui-revisions-1.md` item 1) and the filter column. Where they differ from earlier files,
this file wins. Each item ships with Playwright tests; the checks below are what they prove. All of
it keeps to the Mosaic and Civic theme tokens, keyboard access and labels on every control.

1. **Fediverse posts stay in the feed.** Mastodon `/embed` pages are no longer framed. Clicking a
   fediverse card's body does nothing. Every card with an original to open (every live item) gets
   a clear "Open ↗" button in its footer that opens the original in a new tab
   (`target="_blank"`, `rel="noopener noreferrer"`). This amends ADR-008 point 3 (`needs-adam`).
   - Checks: clicking a fediverse card's body leaves the feed as it was (same URL, no embedded
     view, no reader, no new tab); every live card has "Open ↗" whose `href` is the item's URL,
     with `target="_blank"` and `rel` containing `noopener` and `noreferrer`; samples, which have
     no original, have none; using it marks the item read.

2. **Other items: framed, or a new tab.** Non-fediverse live items (Civic Hubs, feeds) keep the
   embedded view when the framing check allows it. When the check refuses, the click opens the
   original in a new tab instead of the reader view, synchronously, so popup blockers allow it:
   the River checks the visible cards ahead of time (cached as now). When a card is clicked
   before its answer is known, the embedded view opens with a one-click "Open on {host} ↗" screen
   beside the River bar, which becomes the frame if the check then allows it. The reader view is
   retired from the click flow (it remains only for a sample's or a missing item's address).
   - Checks: a visible card's framing check runs before it is clicked; a card whose page refuses
     framing opens its original in a new tab on click, and the River stays on the feed; a card
     whose page allows it opens the embedded view at `/item/{id}`; a card clicked while its check
     is pending shows "Open on {host} ↗" beside the bar, which opens the original in a new tab;
     loading `/item/{id}` for a refused or fediverse item shows that screen; no card click opens
     the reader view.

3. **A narrower River bar.** The embedded view's bar is narrower, with the Mosaic mark centered
   vertically, filling most of its white tile.
   - Checks: the bar is at most 3.5rem (56 px) wide on a desktop; the mark's tile is centered
     vertically in the bar (within a few pixels); the mark fills at least 75% of its tile's width.

4. **The filter column scrolls on its own.** When the left filter column is taller than the
   window, it scrolls by itself, and it stays in place while the feed scrolls.
   - Checks: in a window shorter than the column, the column is no taller than the window below
     the header, can be scrolled to its last control, and keeps its position when the feed
     scrolls.

5. **"Clear all" in the filter column.** At the top of the filter column, just below search, a
   "Clear all" button resets search, circle, content types and networks (everything shows again;
   the mode stays). It shows only when one of those filters is active.
   - Checks: no button with no filter on; with a search, a circle, a type and a network on, it
     shows below the search field, and one click clears all four (the URL keeps only the mode)
     and hides it.
