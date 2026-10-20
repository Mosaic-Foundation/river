# Spec

Put the project spec here before the first thread starts. Threads read this folder first.

A spec that works for an unattended build has:

1. **Goal** — who it's for and what they can do with v1, in a paragraph.
2. **Users and main flows** — numbered steps for each flow a user takes.
3. **Data model** — entities, fields, relationships, who can read and write each.
4. **Outside data sources** — each API or dataset, what it supplies, how it's accessed.
5. **Out of scope for v1** — explicit list. Threads use this to say no.
6. **Acceptance checks** — concrete checks that prove v1 works end to end, written so they can
   become Playwright tests (e.g. "A visitor enters a ZIP code and sees their state legislators").
7. **Build order** — the milestones in the order they should land.

Split long specs into several files in this folder and list them here.
