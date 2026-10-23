# UI revisions 6: the mobile filter

Decided by Adam on 2026-10-23 (sent as "ui-revisions-5.md"; that name was already taken by the
feed-top revision the same day, so this is number 6). It revises the phone's filters
(`ui-revisions-1.md` items 2 and 4, `ui-revisions-4.md` items 1, 4 and 5). It applies below the
desktop breakpoint (56rem); the desktop is unchanged. Where it differs from earlier files, this
file wins. Each item ships with Playwright tests at a phone viewport; the checks below are what
they prove. All of it works the same in Everything and Civic modes, uses the theme tokens, and
keeps the filter state in the URL as now.

1. **One filter button.** The horizontally scrolling filter strips at the top of the phone feed
   are replaced by one full-width "Filter your River" button. With filters on it shows a count
   ("Filter your River · 3") and a short summary of what's on (for example "Family, News and
   ideas · Articles"), cut to one line.
   - Checks: no chip strip on a phone; the button is full width; with no filter it reads "Filter
     your River" and no summary; with two circles and a type on it reads "Filter your River · 3"
     and the summary names them, on one line.

2. **A bottom sheet.** Tapping the button opens a bottom sheet with the desktop column's filter
   content: the "Filter your River" title, search, Circles (multi-select), Content type and
   Networks, as toggle pills that wrap onto several lines (no horizontal scrolling), and Clear
   all. The sheet takes most of the screen height, scrolls inside if needed, and has a drag
   handle.
   - Checks: the sheet opens from the button, is at least 75% of the window's height and no
     taller than it, has a drag handle, and holds the title, search, the three sections and
     their pills; no element in it scrolls sideways; the pills wrap.

3. **Live filters and closing.** Filters apply as they're toggled; the feed updates behind the
   sheet. A sticky footer button reads "Show results". Closing by that button, the drag handle
   (swipe down), tapping outside or the back gesture keeps the selections. Clear all resets to
   Everything (every filter off; the mode stays) without closing.
   - Checks: toggling a pill updates the URL and the feed behind the open sheet; "Show results"
     closes it and the selections stay; the browser's Back closes it, keeps the selections and
     the URL; a tap outside closes it; swiping the handle down closes it; Clear all clears every
     filter and the sheet stays open.

4. **Accessibility.** The sheet is a modal dialog (`role="dialog"`, `aria-modal`, labelled by its
   title). Focus moves into it on open and back to the button on close; Escape closes it; every
   control is reachable by keyboard and screen reader. Reduced motion is respected.
   - Checks: the dialog has those attributes and its accessible name is "Filter your River";
     focus is inside on open and on the button after Escape; Tab reaches every control; with
     reduced motion the sheet opens without animation; axe finds no serious issue.
