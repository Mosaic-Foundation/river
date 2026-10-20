# ADR-004: Instances, hostnames, database roles and RLS

- **Date:** 2026-10-20
- **Status:** Accepted
- **Scope:** `src/db/`, every migration, hostname resolution
- **Extends:** Civic Hub ADR-004 (`decisions/2026-09-22-multi-tenant.md`, forced RLS) and Civic Hub ADR-005 (`pg`)

## Context

The River should be cheap to offer to other organizations later, and each person's data must stay theirs (spec 1, 3). Supabase's service-role key bypasses row-level security, so isolation can't rest on it.

## Decision

- An `instances` table; the request's hostname picks the instance, plus `INSTANCE_HOST_ALIASES` for localhost and vercel.app hosts and every host on a Vercel preview deployment. Only `river.mosaic.social` exists in v1.
- Both apps connect with node-postgres through Supabase's shared pooler (transaction mode, port 6543, username `[role].[project-ref]`) as LOGIN roles `river_app` and `identity_app`. Neither has BYPASSRLS; each has grants only on its own schema; neither schema is exposed through the Data API.
- Each request runs in a transaction that sets `app.instance_id` and `app.account_id` with `SELECT set_config(name, $1, true)` (SET cannot take bind parameters). Every table has `ENABLE` and `FORCE ROW LEVEL SECURITY` with policies on those settings. `forInstance()`, `forAccount()` and `forIdentity()` are the only way to query. No named prepared statements.
- Roles are created NOLOGIN, idempotently, in a migration; passwords are set outside migrations (`supabase/seed.sql` locally; once by Adam on the hosted project).
- Scheduled work is one daily `pg_cron` job defined in a migration, SQL only.

## Alternatives considered

- supabase-js with the service-role key (the template default): RLS wouldn't apply.
- Minted JWTs through PostgREST, as the hub does: works, but adds token minting and exposes the schemas through the Data API.
- A database per instance: the free tier allows two projects.

## Consequences

A bug in a route can't read another person's data. Hosted role passwords are a manual step, documented in the build hand-off.
