## What and why

<!-- One or two sentences. -->

Spec section: <!-- docs/spec/...#... -->

## Checks

<!-- Paste the summary lines from `npm run check` (and `npm run test:e2e` if run). -->

## Merge

- [ ] CI green
- [ ] No `needs-adam` triggers (schema change to existing tables, auth, ADR or outbound call, `.github/`, `.claude/settings.json`, `vercel.json`, `CLAUDE.md`, paid service, new data source)
- [ ] Decisions not covered by the spec are logged in `DECISIONS.md`
- [ ] `HANDOFF.md` entry added at the top
- [ ] No new outbound network calls without an ADR (CLAUDE.md constraint 3)
