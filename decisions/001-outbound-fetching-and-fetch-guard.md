# ADR-001: Outbound fetching and the fetch guard

- **Date:** 2026-10-20
- **Status:** Accepted
- **Scope:** every outbound network request made by River or identity-host server code
- **Extends:** Civic Hub CLAUDE.md constraint 5 and Civic Hub ADR-006

## Context

The River is a reader: following a space means fetching URLs that members type in (spec 4.2, 4.3). The template's constraint 3 forbids outbound calls without an ADR naming the hosts, and a server that fetches user-supplied URLs is open to server-side request forgery unless every request is checked.

## Decision

All outbound requests go through one module, `src/shared/fetch/`, implementing spec Appendix B: HTTPS only; DNS resolved and every address checked against the private, loopback, link-local, CGNAT, multicast, metadata and IPv4-in-IPv6 ranges; the socket pinned to a checked address through a custom `lookup`; redirects followed by hand, at most 3, each re-checked, `http:` refused; 2 MB cap; 6 s timeout; `User-Agent: MosaicRiver/0.1 (+https://river.mosaic.social)`; at most 2 concurrent requests per host; `Retry-After` honored. Allowed hosts:

1. Any public HTTPS host a member or the operator asks to follow, and the hosts those sources point to for actors, outboxes, WebFinger, NodeInfo and boosted objects.
2. Seed hosts: `demosville.civic.social`, `floyd.civic.social`, `longmont.civic.social`, `mastodon.social`, `w3c.social`, `mastodon.archive.org`, `wikis.world`, `socialwebfoundation.org`, and a `fedizen.net` account if Adam approves it.
3. DID resolution only for hosts in `TRUSTED_DID_HOSTS`.
4. Identity host only: `api.resend.com` for email, when `EMAIL_TRANSPORT=resend`.

No other module imports `undici`, `node:http` or `node:https`, or calls global `fetch` on the server. Tests inject a resolver and an undici `Dispatcher`; no production path accepts a private-address override. The daily `pg_cron` job makes no network calls.

## Alternatives considered

- A fixed allowlist of hosts: fails the product, since following arbitrary spaces is the point.
- Plain `fetch` with a URL pre-check: open to DNS rebinding between the check and the connection.
- A separate fetching service: more moving parts than a free-tier demo should carry.

## Consequences

Adapters stay simple and testable. The guard is security-critical, so changes to it are `needs-adam`. M2 ports `civic-hub/src/utils/ssrfGuard.ts` and its tests from `docs/reuse/`; the Foundation approved this reuse on 2026-10-20 while it moves the Civic Hub to AGPL (`docs/reuse/NOTICE.md`).
