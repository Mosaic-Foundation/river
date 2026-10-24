# UI revisions 8: Coming up back, circle pills, the whole window

Adam asked for these on 2026-10-24, with a screenshot of Facebook's home page as the layout
reference. They revise `ui-revisions-1.md` item 6 (Coming up in Everything), `ui-revisions-4.md`
items 1-2 (the filter column's circles) and the desktop grid. Where this file differs from earlier
ones, it wins. The phone layout is unchanged. Each item ships with tests; the checks below are
what they prove.

1. **Coming up is back in Everything.** At some point the right-hand Coming up column stopped
   showing in Everything.
   - Cause: its plugin read only the newest 500 items followed. Busy feeds (Bluesky, the
     fediverse, RSS) now fill those 500, so the hub votes and meetings announced before them fell
     out, and an empty Coming up hid itself.
   - Fix: the plugin also reads the newest dated items (a hub deadline or an event's start).
   - In Everything the column stays even when nothing is coming up, and says so. Civic still
     hides an empty Coming up, because its panel keeps the two placeholder slots.
   - Checks:
     - a member following a hub with an upcoming vote and a feed with 520 newer posts sees the
       vote in Everything's Coming up;
     - Everything shows the Coming up column at desktop width with its dates;
     - with no upcoming dates Everything's Coming up says there's nothing yet, and Civic's is
       hidden.

2. **Circles as pills.** In the filter column, the circles are toggle pills like the content
   types, several to a row, each with its circle's swatch. "All" is the first pill. Four rows
   show; more circles scroll inside the section, with the "Scroll for more circles" hint.
   - Checks:
     - the circles are pills, with fewer rows than circles;
     - with more circles than four rows hold, the section is four rows tall, scrolls to the last
       circle and shows the hint;
     - when they fit there's no inner scroll and no hint;
     - the wheel over a pill still scrolls the column.

3. **The whole window.** On a desktop the page uses the whole window, like Facebook:
   - the filter column against the left edge;
   - from 80rem, Coming up (the mode's panel) against the right edge;
   - the feed centred in the space between, at its reading width;
   - the top bar spanning the window, the brand at the left edge and the actions at the right.

   Between 56rem and 80rem the filters stay against the left edge and the panel sits above the
   feed, as before. The reader view takes the space beside the filters, at most the old feed and
   Coming up widths together, centred.
   - Checks:
     - at 1920 and 1440 px the filters and Coming up are within the gutter of the page's edges,
       and the feed is centred between them at no more than the feed width;
     - at 1100 px the filters are at the left edge and the panel is above the feed;
     - the top bar's brand and Follow button meet its edges;
     - the reader is wider than the feed and ends no further right than Coming up did;
     - nothing scrolls sideways.
