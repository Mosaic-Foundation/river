# ADR-006: One codebase, two deployments

- **Date:** 2026-10-20
- **Status:** Accepted
- **Scope:** repo layout, `src/app.ts`, `identity/`, Vercel projects
- **Extends:** Civic Hub ADR-001 (stack)

## Context

The identity host must be replaceable and must hold the only copy of the master key, while the template assumes one app per repo and one repo per Claude Code project (spec Appendix A).

## Decision

One repository and one codebase. `src/app.ts` builds the Express app for `river` or `identity`, mounting only that side's routes; `identity/api/index.ts` calls `createApp("identity")` explicitly. River code and identity code never import each other; they share `src/shared/` and `src/db/`. Two Vercel projects deploy the repo: `river` from the root, `river-identity` from Root Directory `identity/` with its own `vercel.json` (install and build run from the repo root, static passkey script from `identity/public/`, every other path rewritten to the function) and `api/index.ts`. Each project holds only its own secrets.

## Alternatives considered

- Two repositories: the Claude Code project's settings reach threads only with one repo.
- One Vercel project serving both hostnames: the master key would sit in the River's deployment too. Kept as the fallback if the Root Directory build fails, as a `needs-adam` decision.

## Consequences

The identity host can later move to its own repo or be replaced by another host without touching River code. Vercel Hobby builds one deployment at a time, so each push builds the two projects in turn.
