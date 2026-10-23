# UI revisions 7: a circles menu on each Following row

Decided by Adam on 2026-10-23. It adds to the Following page's lists (`river-v1.md` F7 and F8;
the Spaces and Quiet tabs on `/following` and in the River's phone Following tab). Where it
differs from earlier files, this file wins. Each item ships with Playwright tests; the checks
below are what they prove. It works the same in Everything and Civic modes and uses the theme
tokens.

1. **A Circles control on each row.** Each person or space in the Following list has a
   "Circles" control on its row. It shows the circles the row is in as small coloured swatches
   with names. Clicking it opens a small menu that lists every circle, with a check mark on the
   ones this row belongs to. Clicking a circle adds the row to it or removes it immediately. The
   change is saved as now, through `addToCircle` and `removeFromCircle`
   (`PUT`/`DELETE /api/circles/:id/spaces/:spaceId`). The menu also has "New circle…", which
   creates a circle and adds this row to it in one step.
   - Checks:
     - the control shows the row's circles by name;
     - the menu lists every circle, and the row's circles are checked;
     - clicking an unchecked circle checks it, the row shows it, and a reload still shows it;
     - clicking a checked circle unchecks it and the row drops it;
     - "New circle…" with a name creates the circle; the row is in it, and the Circles panel
       lists it with 1 space.

2. **Immediate, and undone on failure.** The row updates as soon as a circle is clicked. If the
   save fails, the change is undone and the error is shown. The menu closes on Escape, on a
   click outside it, or with a Done button.
   - Checks:
     - the row changes before the save returns;
     - when the save is refused, the check and the row go back and the error shows;
     - Escape, a click outside and Done each close the menu.

3. **Keyboard and screen readers, and phones.** The control is a menu button (`aria-haspopup`,
   `aria-expanded`). Its items are checkable (`menuitemcheckbox` with `aria-checked`). Arrow
   keys move between items, and Space or Enter toggles one. Focus returns to the button when the
   menu closes. At phone width (below 56rem) the menu opens as a small bottom sheet, like the
   mobile filter (`ui-revisions-6.md`).
   - Checks:
     - the button has those attributes and a name that says whose circles it shows;
     - from the keyboard alone, a member can open the menu, move to a circle, toggle it and
       close the menu;
     - focus is back on the button after closing;
     - at 390px wide the menu is pinned to the bottom of the screen, full width, with nothing
       scrolling sideways;
     - axe finds no serious issue with the menu open.

4. **The Circles panel stays.** The existing circle editor in the Circles panel is unchanged.
   - Checks: the existing circles test (create, recolor, rename, add a space, delete) passes
     unchanged, apart from where it reads the row's circles.
