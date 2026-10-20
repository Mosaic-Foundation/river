# ADR-003: The item model and the hub activity allowlist

- **Date:** 2026-10-20
- **Status:** Accepted
- **Scope:** `src/shared/` item types, every adapter, the hub allowlist table

## Context

The River shows many source types in one feed (spec 3.1, 4.1). Hubs publish about 30 activity types, many of them internal steps people don't want in a feed (`civic-hub/src/events/activitySerializer.ts` lines 272-451).

## Decision

- One item shape for every source: kind (`post`, `article`, `podcast`, `video`, `photo`, `event`, `civic`), source id, times, title, summary, sanitized HTML, URL, author, media, boost, audience, civic details, plus the raw object.
- Adapters implement `resolve()` and `fetchNew()`, with fixture tests from recorded real responses.
- The hub allowlist is closed by default and keyed by activity type, object type and process type (spec 4.2's table). Anything else is stored with `hidden = true`, never shown. The table lives in one file with a test per row.
- `items.account_id` and `audience` exist now so person-specific and credential-gated items can arrive later without a migration that rewrites the table.

## Alternatives considered

- Store raw activities and interpret at read time: slower feeds and logic spread through the UI.
- An open allowlist (show unless excluded): every new hub event type would leak into feeds.

## Consequences

New sources only add an adapter. New hub activity types stay invisible until someone adds a row. Readable text depends on per-type templates until hubs send AS2 `summary`.
