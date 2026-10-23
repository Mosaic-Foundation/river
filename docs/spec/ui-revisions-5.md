# UI revisions 5

Decided by Adam on 2026-10-23. These revise the top of the feed (`river-v1.md` F4,
`ui-revisions-4.md` item 5). Where they differ from earlier files, this file wins. Each item ships
with Playwright tests; the checks below are what they prove. All of it keeps to the Mosaic and
Civic theme tokens, keyboard access and labels on every control.

1. **The feed starts with an item.** The middle column has no visible title and no summary line:
   "Everything" (or "Civic") above the feed, "N unread · newest first" and "Mark all read" are
   removed, so the first card sits at the top of the column. A title like "Everything" implied
   everything is always shown, even while filters narrow the feed; and a running unread count and
   "Mark all read" have little value once someone has thousands of items they never mark. Cards
   keep their own unread dot and Mark read / Mark unread. This amends F4 ("Mark all read" for the
   current view) and `ui-revisions-4.md` item 5 ("Keep the unread count and sort line").
   - Checks: in Everything and Civic, at desktop and phone width, the feed's first card is the
     first thing in the middle column (no visible heading, summary line or "Mark all read" above
     it); a card's Mark read still works; the page still has one `h1` naming the view, for
     assistive tech.

2. **"Citizen Dashboard" in Civic mode.** In Civic mode the top bar shows the title "Citizen
   Dashboard", centred. Everything mode shows no title there. The mode switch still says "Civic".
   - Checks: in Civic mode the top bar shows "Citizen Dashboard", centred in the bar on a desktop
     (within a few pixels) and on its own line at phone width without sideways scroll; the page's
     `h1` and the window title say "Citizen Dashboard"; Everything mode shows no top-bar title.
