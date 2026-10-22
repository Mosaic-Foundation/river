# ADR-008: Showing an opened item where it lives, in a sandboxed frame

- **Date:** 2026-10-22
- **Status:** Proposed (amended 2026-10-22 for UI revisions 3: points 1, 3 and 6, and Consequences)
- **Scope:** the embedded view (`ui/src/components/ExternalView.tsx`, `ui/src/lib/embed.ts`), the framing check (`src/river/frame/`, `GET /api/items/{id}/frame`), the River's CSP in `vercel.json`, and the outbound request the check makes
- **Extends:** ADR-001 (outbound fetching and the fetch guard) and ADR-005 (images from source). Amends ADR-001's list of allowed hosts; ADR-001 itself is unchanged.

## Context

UI revisions 2 (Adam, 2026-10-21; `docs/spec/ui-revisions-2.md` item 2) replace the River with an embedded view when a card is clicked, like citizen-dashboard's ExternalView: a narrow bar back to the River and the original source in a sandboxed iframe. Fediverse posts use the post's Mastodon embed page, `{status url}/embed`. Any other page must be checked first, on the server through the fetch guard, for whether it allows framing (`X-Frame-Options`, CSP `frame-ancestors`); a page that refuses opens in the reader view instead. UI revisions 3 (Adam, 2026-10-22; `docs/spec/ui-revisions-3.md` items 1 and 2) stop framing Mastodon embeds (fediverse posts stay in the feed, with "Open ↗" to the original in a new tab) and open a refused page in a new tab instead of the reader. A new tab must open inside the click itself or popup blockers stop it, so the answer has to be known before the click: the River now checks the cards in view ahead of time. A browser won't tell the page that framed a document whether the frame was refused, so the check has to happen before framing, and a cross-origin response's headers can't be read from the River's page (`connect-src 'self'`).

ADR-001 allows the hosts members follow and the hosts those sources point to for actors, outboxes, WebFinger, NodeInfo and boosted objects. An item's own page is a host the source points to, but not for any of those reasons, and for feeds (ADR-007) it can be a different host from the feed's. CLAUDE.md constraint 3 asks for an ADR naming such requests.

## Decision

1. **One more allowed request, added to ADR-001's list:** a GET of the `url` of a stored, live item the reader can see, when that item's card comes into view in the reader's River (or the reader opens its address before then), to read the response's headers. The host is whatever host that URL names (and up to 3 redirects, each re-checked by the guard). It goes through the fetch guard unchanged (HTTPS only, address checks, 6 s cap lowered to 4 s here, 2 MB cap, the River's User-Agent), sends no cookies and `Accept: text/html,application/xhtml+xml`, and drops the body. The endpoint takes an item id, never a URL, so it can only be pointed at pages already in the reader's River. Answers are cached in the process for 10 minutes (1 minute for an unreachable page), at most 500. Samples and items without an https URL are never checked. The River's page asks only for non-fediverse items, at most 3 checks at a time, each item once per page visit; the endpoint itself answers for any item the reader can see.
2. **The rule,** in `src/river/frame/policy.ts`, as browsers apply it: if any enforced `Content-Security-Policy` has `frame-ancestors`, every such policy must have a source matching the River's origin (`RIVER_PUBLIC_ORIGIN`): `*`, a scheme source, or a host source naming the River's host (CSP Level 3 matching); `X-Frame-Options` is then ignored. Otherwise `X-Frame-Options` must be absent or `ALLOWALL`. Where browsers are lenient, the River isn't: `ALLOW-FROM`, unknown values and source paths count as refusals. A non-2xx answer, a response that isn't HTML, a download (`Content-Disposition: attachment`) or a failed request counts as a refusal, and the original opens in a new tab. A page that frames is framed at the URL the check ended on.
3. **Fediverse posts are never framed** (amended by UI revisions 3 item 1; this point first framed Mastodon's `{status url}/embed` pages). A fediverse card's body opens nothing; its "Open ↗" button, like every live card's, opens the original in a new tab with `rel="noopener noreferrer"`. Fediverse items are not checked.
4. **The frame:** `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"` (as citizen-dashboard; no `allow-top-navigation`, so a framed page can't navigate the River), `referrerpolicy="no-referrer"`, an empty `allow` list. Only https URLs are framed. `allow-same-origin` with `allow-scripts` is safe here because a framed page is always on another origin than the River.
5. **CSP:** `frame-src https:` is added to the River's policy in `vercel.json` (today `default-src 'self'` forbids every frame). `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` on the River are unchanged.
6. **What a click does** (UI revisions 3 item 2): a card whose check allowed framing opens the embedded view at `/item/{id}`; one whose check refused opens the original in a new tab, inside the click (`window.open` with `noopener,noreferrer`, or the card's title link with `target="_blank"`); one clicked before its answer arrives opens the embedded view with a one-click "Open on {host} ↗" screen beside the River bar, replaced by the frame if the answer then allows it. No click opens the reader view.

## Alternatives considered

- **Frame every page and fall back on a timeout:** a refused frame still fires `load` with an error page, so the River can't tell, and the reader would see a broken frame.
- **Proxy the page through the River:** would remove the source's own protections and make the River responsible for running other sites' content on its origin.
- **A HEAD request:** smaller, but many servers answer HEAD differently from GET (or not at all), and the headers that matter are the GET's.
- **Let the browser fetch the headers:** blocked by CORS and by `connect-src 'self'`.
- **Check on refresh, for every item:** one request per stored item, for pages nobody scrolls to.
- **Check only on click (as first decided):** the answer arrives after the click, so a refused page could only open in a new tab from a second click, or be blocked as a popup.

## Consequences

- Each non-fediverse card that comes into view costs one guarded request (cached per process for 10 minutes, and once per page visit), whether or not it is opened. A feed of hub items makes a few such requests per screen, at most 3 at a time from one page and 2 at a time per host (the guard).
- The source sees the reader's browser load its page, as when it is opened in a new tab; with `no-referrer` it isn't told it was opened from the River. Images already load from source (ADR-005).
- A framed page runs its own scripts inside the sandbox, in its own origin. If a source turns hostile it can show anything inside its frame, as it could in a new tab; it can't reach the River's page, cookies or storage.
- The check sees the server's answer, which can differ from the browser's (a bot challenge, a geo redirect); in doubt the original opens in a new tab.
- The reader's audio and video players are no longer reached from a card: a live item opens framed or in a new tab. The reader shows only at the address of an item without a live page (a sample).
