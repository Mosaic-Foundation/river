# UI revisions 4

Decided by Adam on 2026-10-23. These revise the filters (`river-v1.md` F5, `ui-revisions-1.md`
items 2-4, `ui-revisions-3.md` items 4-5). Where they differ from earlier files, this file wins.
Each item ships with Playwright tests; the checks below are what they prove. All of it applies in
Everything and Civic modes and at phone width, keeps to the Mosaic and Civic theme tokens, and
keeps keyboard access and labels on every control.

1. **Circles are multi-select.** Clicking a circle toggles it, with the selected look and a check
   mark, like the content-type pills. Several can be on at once; none selected means All. "All"
   clears the circle selection. Filters combine as (any selected circle) AND (any selected content
   type) AND (any selected network) AND search: Family + News and ideas + Articles shows articles
   from either circle. The selection is in the URL, so a filtered River can be linked and survives
   Back.
   - Checks: two circles on show items from either circle and no others, each with
     `aria-pressed="true"` and a check mark; adding a content type narrows that to the type; "All"
     clears both and shows everything; the URL carries both circles, loading it shows the same
     selection, and it survives opening an item and going Back; the phone chip row toggles circles
     the same way; in Civic mode only the civic circle is listed and switching to Civic keeps only
     selected civic circles.

2. **Six circles, then scroll.** On a desktop the Circles section shows at most six circles; more
   than six scroll inside the section, with a visible hint that it scrolls. The rest of the filter
   column keeps scrolling as now (`ui-revisions-3.md` item 4).
   - Checks: with seven or more circles, the circle list is no taller than six rows, scrolls to
     its last circle, and shows the hint; with six or fewer, no hint and no inner scroll.

3. **A title.** The top of the filter column reads "Filter your River".
   - Checks: the filter column's first heading is "Filter your River".

4. **A compact "Clear all".** "Clear all" is a compact, clearly visible button: filled or
   outlined in the theme's primary colour, small padding, on one line, taking little vertical
   space. It still appears only when a filter is active.
   - Checks: hidden with no filter on; with a filter on, it is one line, at most 2rem (32 px)
     tall, and its border or background is the theme's primary colour in both modes; one click
     clears every filter.

5. **No active-filter chips.** The chips above the feed (`ui-revisions-1.md` item 3) are removed,
   since the filter column already shows what's selected. The unread count and sort line stay.
   - Checks: with filters on, no active-filter chips show above the feed; the "N unread · newest
     first" line still shows; at phone width "Clear all" is reachable from the filter chip row.
