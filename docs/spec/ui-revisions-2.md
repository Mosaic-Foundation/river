# UI revisions 2

Decided by Adam on 2026-10-21. These revise how an item opens (`ui-revisions-1.md` item 1, which
revised `river-v1.md` F4). Where they differ from either file, this file wins. Each item ships with
Playwright tests; the checks below are what they prove. All of it keeps to the Mosaic and Civic
theme tokens, keyboard access and labels on every control.

1. **The filter column stays put.** The left filter column never moves or changes width when an
   item opens in the River's layout (the reader view, or while the River checks whether a page can
   be shown in place).
   - Checks: in Everything at desktop width (where the Coming up column shows), the filter
     column's position and width are the same before and after an item opens in the reader, and
     after Back.

2. **Embedded view.** Clicking a card replaces the River with an embedded view, like
   citizen-dashboard's ExternalView: a narrow full-height bar on the left with the Mosaic mark and
   "River", and the rest of the window showing the original source in a sandboxed iframe.
   Clicking the bar returns to the River at the same scroll position and filters. The item keeps
   its own URL, `/item/{id}` with the feed's query string, so the browser's Back and Forward work.
   - Fediverse posts frame the post's Mastodon embed, `{status url}/embed`, where the status URL
     is a Mastodon status (`https://host/@name/{id}`).
   - Any other URL is checked first, on the server through the fetch guard (ADR-001, ADR-008):
     the River frames it only when the page's response allows framing (no `X-Frame-Options`, and
     no `Content-Security-Policy` `frame-ancestors` that leaves the River out). If it doesn't, or
     the check fails, the item opens in the existing reader view, with "Open in new tab".
   - Items with no live URL (samples) open in the reader view.
   - The CSP gains `frame-src https:` (a `vercel.json` change, `needs-adam`).
   - Checks: a Mastodon post's card opens the embedded view at `/item/{id}` with an iframe on
     `{status url}/embed`, sandboxed, and the bar with the Mosaic mark and "River"; the feed
     isn't shown; the bar returns to the feed at the same scroll position with the filters in the
     URL; the browser's Back returns too, and Forward reopens the item; loading `/item/{id}`
     directly opens the embedded view; a page whose headers allow framing (checked on the server
     from a recorded response) opens framed; a page that refuses (`X-Frame-Options: DENY`,
     `frame-ancestors 'none'`) opens in the reader with "Open in new tab"; a sample opens in the
     reader; the CSP has `frame-src https:`; the bar is a keyboard-reachable, labelled control.

3. **The reader is wide.** Where the reader view is used, it takes the full width of the middle
   and right columns (the feed's and Coming up's).
   - Checks: in Everything at desktop width, the reader's left edge is the feed column's and its
     right edge is the Coming up column's; the Coming up column isn't shown beside it; on a
     phone the reader fits 390 px.
