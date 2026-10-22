# ADR-008: Showing an opened item where it lives, in a sandboxed frame

- **Date:** 2026-10-22
- **Status:** Proposed
- **Scope:** the embedded view (`ui/src/components/ExternalView.tsx`, `ui/src/lib/embed.ts`), the framing check (`src/river/frame/`, `GET /api/items/{id}/frame`), the River's CSP in `vercel.json`, and the outbound request the check makes
- **Extends:** ADR-001 (outbound fetching and the fetch guard) and ADR-005 (images from source). Amends ADR-001's list of allowed hosts; ADR-001 itself is unchanged.

## Context

UI revisions 2 (Adam, 2026-10-21; `docs/spec/ui-revisions-2.md` item 2) replace the River with an embedded view when a card is clicked, like citizen-dashboard's ExternalView: a narrow bar back to the River and the original source in a sandboxed iframe. Fediverse posts use the post's Mastodon embed page, `{status url}/embed`. Any other page must be checked first, on the server through the fetch guard, for whether it allows framing (`X-Frame-Options`, CSP `frame-ancestors`); a page that refuses opens in the reader view instead. A browser won't tell the page that framed a document whether the frame was refused, so the check has to happen before framing, and a cross-origin response's headers can't be read from the River's page (`connect-src 'self'`).

ADR-001 allows the hosts members follow and the hosts those sources point to for actors, outboxes, WebFinger, NodeInfo and boosted objects. An item's own page is a host the source points to, but not for any of those reasons, and for feeds (ADR-007) it can be a different host from the feed's. CLAUDE.md constraint 3 asks for an ADR naming such requests.

## Decision

1. **One more allowed request, added to ADR-001's list:** a GET of the `url` of a stored, live item the reader can see, when the reader opens that item, to read the response's headers. The host is whatever host that URL names (and up to 3 redirects, each re-checked by the guard). It goes through the fetch guard unchanged (HTTPS only, address checks, 6 s cap lowered to 4 s here, 2 MB cap, the River's User-Agent), sends no cookies and `Accept: text/html,application/xhtml+xml`, and drops the body. The endpoint takes an item id, never a URL, so it can only be pointed at pages already in the reader's River. Answers are cached in the process for 10 minutes (1 minute for an unreachable page), at most 500. Samples and items without an https URL are never checked; Mastodon embeds are never checked.
2. **The rule,** in `src/river/frame/policy.ts`, as browsers apply it: if any enforced `Content-Security-Policy` has `frame-ancestors`, every such policy must have a source matching the River's origin (`RIVER_PUBLIC_ORIGIN`): `*`, a scheme source, or a host source naming the River's host (CSP Level 3 matching); `X-Frame-Options` is then ignored. Otherwise `X-Frame-Options` must be absent or `ALLOWALL`. Where browsers are lenient, the River isn't: `ALLOW-FROM`, unknown values and source paths count as refusals. A non-2xx answer, a response that isn't HTML, a download (`Content-Disposition: attachment`) or a failed request also opens the reader. A page that frames is framed at the URL the check ended on.
3. **Mastodon posts** (fediverse items whose URL is `https://host/@name/{digits}` or `https://host/users/{name}/statuses/{digits}`) frame `{url}/embed`, which Mastodon serves for framing (no `X-Frame-Options`, no `frame-ancestors`, recorded on w3c.social and mastodon.social on 2026-10-22). Other fediverse software goes through the check.
4. **The frame:** `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"` (as citizen-dashboard; no `allow-top-navigation`, so a framed page can't navigate the River), `referrerpolicy="no-referrer"`, an empty `allow` list. Only https URLs are framed. `allow-same-origin` with `allow-scripts` is safe here because a framed page is always on another origin than the River.
5. **CSP:** `frame-src https:` is added to the River's policy in `vercel.json` (today `default-src 'self'` forbids every frame). `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` on the River are unchanged.

## Alternatives considered

- **Frame every page and fall back on a timeout:** a refused frame still fires `load` with an error page, so the River can't tell, and the reader would see a broken frame.
- **Proxy the page through the River:** would remove the source's own protections and make the River responsible for running other sites' content on its origin.
- **A HEAD request:** smaller, but many servers answer HEAD differently from GET (or not at all), and the headers that matter are the GET's.
- **Let the browser fetch the headers:** blocked by CORS and by `connect-src 'self'`.
- **Check on refresh, for every item:** one request per stored item instead of one per opened item, for pages nobody opens.

## Consequences

- Opening a non-Mastodon live item costs one guarded request (cached), and up to 4 s of "Opening {host}…" before the frame or the reader shows.
- The source sees the reader's browser load its page, as when it is opened in a new tab; with `no-referrer` it isn't told it was opened from the River. Images already load from source (ADR-005).
- A framed page runs its own scripts inside the sandbox, in its own origin. If a source turns hostile it can show anything inside its frame, as it could in a new tab; it can't reach the River's page, cookies or storage.
- The check sees the server's answer, which can differ from the browser's (a bot challenge, a geo redirect); in doubt it opens the reader.
- A Mastodon status whose server isn't Mastodon but uses the same URL shape would show that server's answer to `/embed` (likely a 404 page) in the frame. Recorded seeds don't have such a server; a later pass could check those hosts' NodeInfo.
