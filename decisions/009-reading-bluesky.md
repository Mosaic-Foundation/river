# ADR-009: Reading Bluesky and the AT Protocol

- **Date:** 2026-10-23
- **Status:** Proposed
- **Scope:** the Bluesky adapter (`src/river/adapters/bluesky/`), the follow box and "Import from Bluesky" on the Follow screen, the refresh of Bluesky spaces, and the outbound requests they make
- **Extends:** ADR-001 (outbound fetching and the fetch guard) and ADR-003 (the item model). Amends ADR-001's list of allowed hosts; ADR-001 itself is unchanged.

## Context

Adam's plan (2026-10-23) starts Phase 2 with reading Bluesky: a member follows a Bluesky account by handle (`@name.bsky.social` or a custom-domain handle), by `bsky.app` profile URL or by DID; the River shows its posts like fediverse posts; and "Import from Bluesky" follows every account a Bluesky account follows. Spec 3.1 and 4.1 already reserve an `atproto` adapter value and a stub; spec 5 lists atproto as out of scope for v1, and this plan brings it in.

The AT Protocol separates three things the River has to reach:

- **Identity.** A handle is a domain name. It resolves to a DID through a DNS TXT record at `_atproto.{handle}` or an HTTPS document at `https://{handle}/.well-known/atproto-did` ([atproto handle spec](https://atproto.com/specs/handle)). A DID resolves to a DID document: `did:plc` through the PLC directory (`https://plc.directory/{did}`), `did:web` at `https://{domain}/.well-known/did.json` ([atproto DID spec](https://atproto.com/specs/did)). The document's `alsoKnownAs` names the handle back (`at://{handle}`); a handle is only valid when both directions agree. Handles change; DIDs don't.
- **Posts.** An account's records live on its PDS, but threads, reposts with their original posts, quoted posts, image and video URLs and link cards are assembled by an AppView. Bluesky runs a public, unauthenticated, cached AppView at `public.api.bsky.app` and asks developers to use it "for public web use cases".
- **The social graph.** `app.bsky.graph.getFollows` on the same AppView lists who an account follows, 100 per page with a cursor.

ADR-001 allows any public host a member asks to follow and the hosts those sources point to for actors, outboxes, WebFinger, NodeInfo and boosted objects. A Bluesky account is a source a member asks for, but the hosts that serve it (an AppView and a DID directory) are neither the handle's host nor any of the hosts ADR-001 names, and a handle's own host is asked a different question (`/.well-known/atproto-did`). CLAUDE.md constraint 3 asks for an ADR naming them.

## Decision

1. **Allowed hosts, added to ADR-001's list.** Every request goes through the fetch guard unchanged (HTTPS only, address checks, 6 s, 2 MB, at most 2 in flight per host, `Retry-After` honored, the River's User-Agent). All are unauthenticated GETs of public data: no account, no app password, no OAuth, no cookies, nothing written.
   - `public.api.bsky.app`, Bluesky's public AppView, for exactly these XRPC methods:
     - `com.atproto.identity.resolveHandle` (handle to DID; the AppView checks the DNS TXT record and the HTTPS document);
     - `app.bsky.actor.getProfile` (name, avatar, bio and labels for the follow preview);
     - `app.bsky.feed.getAuthorFeed` (an account's posts and reposts, `filter=posts_no_replies`, at most 50 per page);
     - `app.bsky.graph.getFollows` (the import; 100 per page, at most 10 pages, so at most 1,000 accounts per import).
   - `plc.directory`, the PLC directory, to read the DID document of a `did:plc` (`GET https://plc.directory/{did}`).
   - For a `did:web`, the domain the DID names, at `https://{domain}/.well-known/did.json` only.
   - For a handle, the handle's own domain at `https://{handle}/.well-known/atproto-did` only, when the AppView can't resolve it.
2. **Resolving what was typed.** The follow box takes `@handle` (`@name.bsky.social` or a custom-domain handle such as `@example.com`), a bare `name.bsky.social` (a bare custom domain stays a web address, for the hub and feed adapters), `https://bsky.app/profile/{handle or DID}`, a `did:plc:` or `did:web:` DID, or an `at://` URI of an account. A handle resolves to a DID through the AppView's `resolveHandle`, falling back to the handle's HTTPS document; the DID document is then read from its directory or domain, and the handle is accepted only when the document's `alsoKnownAs` names it. A DID typed directly takes its handle from the profile. The preview shows the display name (else the handle), the avatar and the bio. The handle's DNS TXT record is checked by the AppView, not by the River: the guard resolves A and AAAA records only, and a TXT lookup of its own would be a change to the guard.
3. **Spaces are keyed by DID.** `canonical_url` is `at://{did}`, `actor_id` the DID, `home_url` `https://bsky.app/profile/{did}`, `network` `bluesky`, `adapter` `atproto` (already allowed by the `spaces.adapter` CHECK). Following the same account by handle, profile URL or DID finds the same space; a handle change only updates the stored name and handle. Each refresh reads the account's current handle, name and avatar from the posts it fetches, so no extra request is made for them.
4. **Mapping to items (ADR-003).** Only posts the AppView serves without signing in are read. A post becomes a `post`; with images (`app.bsky.embed.images`) a `photo`, each image a `media` entry with its alt text; with a video (`app.bsky.embed.video`) a `video` whose `media` is the thumbnail only (no player: the playlist is HLS, which most browsers can't play without a script library), opened with "Open ↗"; a link card (`app.bsky.embed.external`) and a quoted post (`app.bsky.embed.record`, and `recordWithMedia`) are kept in the item as structured data the card draws: the link's https URL, title, description and thumbnail, and the quoted post's author, text, time, link and images. A repost becomes a boost card under the original author, like a fediverse boost: the item keeps the repost's id, time and reposter, and `boost_of` names the original post and author with `fetched: true` (the AppView is the source for both). Replies are hidden, as on the fediverse; a repost of a reply is shown. Post text is plain text: it is escaped, and link, mention and hashtag facets become links to their https URLs or to `bsky.app`, then the HTML goes through `src/shared/sanitize/`. An item's URL is `https://bsky.app/profile/{did}/post/{rkey}`. Posts the author or Bluesky's moderation label as adult content (`porn`, `sexual`, `nudity`, `graphic-media`) are stored hidden, and an account labelled `!no-unauthenticated` (its owner asked not to be shown to people who aren't signed in) can't be followed.
5. **Bluesky posts stay in the feed,** like fediverse posts (ui-revisions-3 item 1): "Open ↗" opens the post on `bsky.app` in a new tab, the card body opens nothing, and no framing check (ADR-008) is made for them. Images, avatars and thumbnails load in the browser from Bluesky's CDN as ADR-005 says; the server never fetches media.
6. **Rate limits.** Bluesky's rate-limit page (bsky-docs, checked 2026-10-23) gives the AppView no number: "These API services have generous rate-limits. Please contact us if you encounter rate-limiting", and `public.api.bsky.app` answers with `cache-control: public, max-age=30`. The published numbers are for other services: a PDS allows 3,000 requests per 5 minutes per IP, and writes are counted in points per account (the River makes none). The PLC directory publishes no limit. The River stays far below any of these: no Bluesky space is refreshed more often than every 120 s (spec 4.5), at most 12 Bluesky spaces are refreshed per feed open (a capped, rotating subset, newest posters first; the design is in `DECISIONS.md`), an import reads at most 10 pages of follows, and a 429 or 503 with `Retry-After` stops requests to that host until then (the guard). One feed open therefore makes at most 24 AppView requests (one page per space, two on a space's first fetch), 2 at a time.
7. **Nothing else.** No firehose, Jetstream or relay subscription; no PDS reads (`com.atproto.repo.*`); no sign-in, posting, liking or following on Bluesky; no other AppView unless a later ADR names it.

## Alternatives considered

- **Read each account's PDS directly** (`com.atproto.repo.listRecords`): no dependency on Bluesky's AppView, but a PDS returns bare records: reposts and quotes would be record references without the original post, images would be blob references, and every PDS is a different host to reach. A later ADR can add it for accounts the AppView won't serve.
- **Subscribe to the firehose or Jetstream:** real-time, but needs a long-running connection, which Vercel functions can't hold, and far more data than a reader needs.
- **Resolve handles only through DNS TXT, in the River:** the guard resolves addresses, not TXT records; adding TXT would be a guard change, and the AppView already checks both methods. The River still checks the DID document's `alsoKnownAs` itself.
- **Trust the AppView's handle without reading the DID document:** one request fewer, but the River would take the handle-to-DID link on the AppView's word alone.
- **Key spaces by handle:** a handle change would split one account into two spaces, or point an old handle at someone else.
- **Import by resolving each followed account:** two or three requests per account; `getFollows` already returns each account's DID, handle, name, avatar and bio.

## Consequences

- Members can follow Bluesky accounts and bring their Bluesky follows over in one step; the River reads them without a Bluesky account.
- The River depends on Bluesky's public AppView for Bluesky content. If it is down, rate-limits the River or stops serving unauthenticated reads, Bluesky spaces show a quiet error on Following and stop updating; fediverse and hub spaces are unaffected.
- Accounts that hide from signed-out readers, and posts labelled as adult content, aren't shown. Content-warning handling for other labels stays out of scope (spec 5).
- A member who imports hundreds of accounts sees the most active ones fresh on each open and the rest over the next opens, not all at once.
- Video plays on Bluesky, not in the River, until the River has a player for HLS.
- New outbound hosts: changes to this list are `needs-adam` (CLAUDE.md constraint 3).
