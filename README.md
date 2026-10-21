# greenfield-starter

Template repo for building a new project with an autonomous Claude Code project, then graduating
it to a normal, stricter repo. The procedure is the Greenfield Project Runbook (a Claude doc); this
repo holds the files every new project starts with. The stack and conventions copy the Civic Hub
(Civic-Social-Mono/civic-hub) so the two codebases stay alike. License: AGPL-3.0.

## Stack

Node 24 + TypeScript + Express (server, `src/`), Vercel serverless entry (`api/index.ts`),
React 19 + Vite (`ui/`), Supabase Postgres (`supabase/migrations/`), Vitest + Playwright.
Installs use npm 12.2.0, as in the Civic Hub CI.

## What's here

| Path | Purpose |
| --- | --- |
| `CLAUDE.md` | Rules every thread loads: stack, constraints, workflow, merge rules, database and security rules |
| `HANDOFF.md`, `TESTING.md` | Per-slice session log and test log, in the Civic Hub's format |
| `decisions/` | ADRs (`000-template.md`), same format as Civic-Social-Mono/decisions |
| `DECISIONS.md` | Small calls the spec didn't settle, and spec questions |
| `docs/spec/README.md` | The seven parts a spec needs for an unattended build; replaced by the real spec |
| `src/app.ts`, `src/index.ts`, `api/index.ts` | Express app, local dev server, Vercel serverless wrapper |
| `src/config/env.ts` | The only place `process.env` is read (lint-enforced) |
| `src/db/client.ts` | `getDb()`; the only place the raw Supabase client is imported (lint-enforced) |
| `ui/` | Vite + React app; `/api/*` proxied to :3000 in dev |
| `vercel.json` | Build, output, `/api` rewrite, SPA fallback, security headers |
| `tests/unit`, `tests/api`, `tests/e2e` | Vitest unit, HTTP API tests, Playwright smoke test |
| `.github/workflows/ci.yml` | The single `ci` check the ruleset requires |
| `.github/workflows/deploy-migrations.yml` | Applies merged migrations to the hosted dev Supabase project |
| `.claude/settings.json` | Allow and deny rules for threads |
| `.claude/agents/spec-reviewer.md` | Fresh-context reviewer that checks a diff against the spec |
| `.claude/skills/finish-task/SKILL.md` | Steps from finished code to merged PR |
| `ops/new-project.sh` | Phase 1 setup script; run in your Mac Terminal, never in a Claude session |
| `ops/project-instructions.template.md` | Text for the Claude Code project's instructions |
| `ops/cloud-environment-setup.sh` | Paste into the cloud environment's Setup script field (Node 24, npm 12, Playwright Chromium, cached Supabase images) |

## Starting a new project

From the folder that holds this checkout (e.g. `~/Developer`):

```
greenfield-starter/ops/new-project.sh <project-name>
```

The script asks before every step, clones the new repo next to this one, and prints what's left
to do by hand.

## Who holds which credential

| Credential | Held by | Threads see it? |
| --- | --- | --- |
| GitHub | Claude's GitHub proxy, limited to repos attached to the session | No |
| Supabase scoped token, DB password, session pooler URI (`SUPABASE_DB_URL`) | Secrets of the `supabase-dev` GitHub environment, deployable only from `main`; used by `deploy-migrations` | No |
| Supabase URL + service-role key | Vercel environment variables (server-side) | No |
| Vercel | Vercel's Git integration deploys on push; no token needed | No |

Threads build and test against a local Supabase stack in their own sandbox.

## Notes

- A scoped Supabase access token needs **API Keys: read** and **API Key Secrets: read** for
  `supabase link` to succeed.
- GitHub's hosted runners have no IPv6, and Supabase's direct database host is IPv6-only, so
  `supabase db push` fails there with "IPv6 is not supported on your current network". Put the
  project's session pooler URI (port 5432) in the `supabase-dev` secret `SUPABASE_DB_URL`;
  `deploy-migrations` passes it as `db push --db-url`.
- Rulesets on private repos need a paid GitHub plan. The script defaults to a public repo.
- Permission rules in `.claude/settings.json` only reach cloud threads when the Claude Code
  project has exactly one repository. Keep each project to one repo.
- `__REPO__` in `CLAUDE.md`, `.claude/settings.json` and the finish-task skill is replaced with the
  project's `owner/name` by `ops/new-project.sh`, so threads may call `gh api` on that repo only.
