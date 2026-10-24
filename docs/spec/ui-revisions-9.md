# UI revisions 9: a profile menu, My information, dark mode

Adam asked for these on 2026-10-24. They revise the River's top bar (`river-v1.md` spec 2, F3,
F10) and add a color scheme to both themes. Where this file differs from earlier ones, it wins.
Each item ships with tests; the checks below are what they prove.

1. **A profile menu.** A round profile button sits at the right end of the top bar on desktop and
   phone. It shows the member's initials when they have a display name, else a person icon. It
   opens a menu:
   - for a member: My information, Settings and Sign out;
   - for a visitor: Settings and Sign in.

   **My information** is a dialog with three parts:
   - a short description of what a DID is;
   - what a Mosaic DID is;
   - the member's own DID, with a Copy button.

   The DID and the member's name come off the top bar. Sign out moves into the menu. The menu is
   a menu button with menu items. Arrow keys, Home and End move between items, Escape or a click
   outside closes it, and focus returns to the button.
   - Checks:
     - a signed-in member's top bar doesn't contain their DID;
     - the menu lists My information, Settings and Sign out, and My information shows the DID and
       both descriptions;
     - Sign out from the menu signs out;
     - a visitor's menu is Settings and Sign in;
     - the keyboard path works and focus returns;
     - at 390 px the menu stays on screen;
     - axe finds no serious issue.

2. **Dark mode.** Settings has a "Dark mode" switch (`role="switch"`), and both themes, Mosaic
   and Civic, have a dark version.
   - The choice is saved in this browser.
   - Until someone chooses, the River follows the device's setting.
   - The scheme is applied before the first paint, so there is no light flash.
   - Every page of the River UI follows it, the Following page included.
   - Checks:
     - the switch turns dark on and off;
     - the page background changes;
     - the choice survives a reload, in Everything and Civic;
     - a browser that prefers dark opens dark;
     - axe finds no serious issue, contrast included, in dark;
     - unit tests hold every text pair in both themes' dark tokens to WCAG AA.
