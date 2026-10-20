# ADR-005: Images load straight from their source in v1

- **Date:** 2026-10-20
- **Status:** Accepted
- **Scope:** item media and avatars in the UI

## Context

Cards need avatars and media (spec 4.8). Proxying or storing images costs bandwidth and storage the demo shouldn't pay for.

## Decision

The browser loads images directly from their HTTPS source with `loading="lazy"` and `referrerpolicy="no-referrer"`. No spinner; an image that fails is removed and the card renders without it. CSP allows `img-src 'self' https:`. The River builds no link previews and no thumbnails.

## Alternatives considered

- An image proxy: hides the reader's IP from sources and allows resizing, at a cost.
- Storing thumbnails in Supabase Storage: uses the free tier's storage quickly.

## Consequences

Sources see the reader's IP address when images load. A thumbnail and privacy proxy is the planned replacement when the River serves real users; it will need its own ADR.
