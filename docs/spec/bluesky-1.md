# Bluesky reading (Phase 2, step 1)

2026-10-23 · Adam

The first Bluesky step in Phase 2 of the plan. It brings in the atproto adapter that spec 4.1
left as a stub and spec 5 left out of v1. Where it differs from `river-v1.md` or the UI
revisions, it wins. The hosts and the reasons for them are in ADR-009
(`decisions/009-reading-bluesky.md`).

1. **ADR-009 "Reading Bluesky and the AT Protocol"** (Proposed): names the new outbound hosts
   and why: Bluesky's public AppView (`public.api.bsky.app`), DID resolution (`plc.directory`
   for `did:plc`, the domain itself for `did:web`), and handle resolution (DNS `_atproto` TXT or
   `https://{handle}/.well-known/atproto-did`). Everything goes through the fetch guard,
   unauthenticated, public data only. Bluesky's current rate limits are recorded in the ADR.
   That PR is `needs-adam`.
2. **Adapter** (`src/river/adapters/bluesky/`): Follow accepts a Bluesky handle
   (`@name.bsky.social` or a custom-domain handle), a bsky.app profile URL, or a DID. It resolves
   to a DID, shows a preview (name, avatar, bio), and on confirm stores the source. Refresh reads
   `app.bsky.feed.getAuthorFeed`. Posts map to the item model (ADR-003): text post, photo
   (images with alt text), link card (external embed), quote post (the quoted post shown inside),
   reposts as boost cards with the original author like fediverse boosts, and video as a
   thumbnail with Open ↗. Replies are hidden, as on the fediverse. Handles change: sources are
   keyed by DID.
3. **Bluesky network:** "Bluesky" in the Networks filter. Bluesky posts behave like fediverse
   posts: they stay in the feed with "Open ↗" to bsky.app.
4. **Import follows:** on the Follow screen, "Import from Bluesky": enter a handle, the River
   lists the accounts it follows (`app.bsky.graph.getFollows`, paginated), shows a preview with a
   count, lets the person choose a circle, and follows them all. Refresh for large lists
   (hundreds of accounts) stays within Vercel's limits: a capped, rotating subset per visit,
   prioritized by recency, with the design logged in `DECISIONS.md`.
5. **Tests:** real fixtures recorded from a few public accounts (bsky.app, a custom-domain
   handle, an account with images, a repost and a quote), unit tests for the mapping, API tests
   for follow and import, and a Playwright test for following a handle and filtering by Bluesky.

Only the ADR PR (and anything that changes `vercel.json` or adds hosts) is `needs-adam`; the rest
merges when `ci` is green, after the ADR PR is merged.
