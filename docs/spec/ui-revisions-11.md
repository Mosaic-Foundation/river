# UI revisions 11: no Following link in the bar, one source at a time

Adam asked for these on 2026-10-24. They revise the top bar (`ui-revisions-9.md` item 1) and the
filters (`river-v1.md` F5, `ui-revisions-10.md`). Where this file differs from earlier ones, it
wins. Each item ships with tests; the checks below are what they prove.

1. **No Following link in the bar.** The top bar's "Following" text link next to Follow is gone:
   it did what Follow does for a member (both open the Following page). The profile menu gains a
   "Following" item for members, which keeps the mode as the link did.
   - Checks:
     - a member's top bar has no Following link;
     - the menu lists My information, Following, Settings and Sign out;
     - Following from the menu opens `/following` with the mode kept (Civic stays Civic).

2. **One source at a time.** The filters get a "Source" choice: a dropdown in the filter column
   (and the phone's filter sheet) listing every source the current mode shows, by name, with
   "All sources" first. Choosing one shows only that source's posts. It combines with the other
   filters, sits in the URL (`source=`), counts as a filter (so "Clear the filter" clears it),
   and shows in the phone button's summary. A card's source name also chooses it: clicking the
   name shows only that source.
   - Checks:
     - the API accepts `source` (a space id), returns only that space's items, refuses a
       malformed id, and lists the mode's sources (id, name, network) on every page;
     - the dropdown lists the sources and filters the feed to one;
     - the URL keeps it across a reload;
     - "Clear the filter" clears it;
     - clicking a card's source name filters to it;
     - the phone sheet has the same dropdown.
