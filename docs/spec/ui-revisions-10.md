# UI revisions 10: one filter button, narrowing gaps

Adam asked for these on 2026-10-24. They revise the desktop filter column (`ui-revisions-3.md`
item 5, `ui-revisions-4.md` items 3-4) and the desktop grid (`ui-revisions-8.md` item 3). Where
this file differs from earlier ones, it wins. The phone's filter sheet keeps its title and compact
"Clear all". Each item ships with tests; the checks below are what they prove.

1. **One wide filter button.** The filter column's "Filter your River" title and its "Clear all"
   button are gone. One wide button sits under "Search your River".
   - While no filter is on it reads "Filter your River". Clicking it opens any collapsed section
     and moves focus to the first filter.
   - As soon as any filter is on (a circle, a content type, a network or a search) it reads "Clear
     the filter". Clicking it clears every filter and keeps the mode. The button stays, back to
     "Filter your River", and keeps focus.
   - Checks:
     - the column has no title and no Clear all;
     - the button is as wide as the search field and just under it;
     - it reads "Filter your River", then "Clear the filter" after a type or a network is chosen;
     - clearing resets every filter, keeps Civic mode and keeps focus on the button;
     - with nothing on, it opens a collapsed section and focuses the first pill;
     - in Civic it is filled in Civic's primary colour.

2. **The gaps narrow first.** As the window narrows toward the width where the layout drops a
   column, the gaps between the columns shrink before the feed does.
   - Gap sizes: 2rem when there's room, down to 0.5rem near the breakpoint. That is a quarter of
     the width above 80rem for three columns, and above 56rem for two.
   - Checks:
     - three columns: a 32 px gap at 1440 px and under 16 px at 1310 px, with nothing scrolling
       sideways;
     - two columns: 32 px at 1100 px and under 16 px at 930 px.
