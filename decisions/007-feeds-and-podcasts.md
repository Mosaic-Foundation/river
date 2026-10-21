# ADR-007: RSS, Atom and podcast feeds as a source type, and PeerTube channels

- **Date:** 2026-10-21
- **Status:** Proposed
- **Scope:** the feed adapter (`src/river/adapters/rss/`), the PeerTube reading in the fediverse adapter (`src/river/adapters/fediverse/peertube.ts`), `river.spaces.adapter`, and the outbound requests both make
- **Extends:** ADR-001 (outbound fetching and the fetch guard) and ADR-003 (the item model). Amends ADR-001's list of allowed hosts; ADR-001 itself is unchanged.

## Context

Spec section 7 adds M12 (stretch), "Real media: a PeerTube channel through the fediverse adapter; an RSS/podcast adapter", and section 5 lists "An RSS or podcast adapter, and real video or podcast seeds" as stretch M12. Adam approved M12 and the new source type on 2026-10-21.

ADR-001 allows "any public HTTPS host a member or the operator asks to follow, and the hosts those sources point to for actors, outboxes, WebFinger, NodeInfo and boosted objects". A feed is a source a member asks for, so the feed's own host is already covered. Three kinds of request are not named there: following a web page's feed link (which can be on another host), reading the feed document itself, and fetching a PeerTube channel's Video objects (a channel's outbox announces its videos by IRI instead of embedding them, so without the Video the card has no title, length or thumbnail). They need to be named here. A new source type is also a lasting choice (a new `spaces.adapter` value, a new kind of outside data source) and the database enforces the adapter list with a CHECK.

## Decision

1. **A new adapter value, `rss`,** for RSS 2.0 (and 0.9x), RSS 1.0 and Atom (RFC 4287) feeds, including podcast feeds with Apple's podcast namespace and Media RSS. The migration `20261021200000_rss_adapter.sql` widens the `spaces.adapter` CHECK by that one value. The adapter is last in the registry because it takes any https URL; the Civic Hub and fediverse adapters keep their order and behaviour.
2. **Mapping** (ADR-003's item shape, no new column): an audio enclosure makes a `podcast`, otherwise a video enclosure makes a `video`, otherwise an entry with a title is an `article` and one without a `post`. `itunes:duration` (seconds, `MM:SS`, `HH:MM:SS`) or Media RSS `duration` goes on the audio or video `media` entry in seconds; the episode image, Media RSS thumbnail or (podcasts) the show's cover art is an `image` media entry. Only https URLs are kept. All HTML goes through `src/shared/sanitize/`; titles and summaries are plain text. An RSS `<author>` is an email address with an optional name: only the name is kept, anywhere it is stored (CLAUDE.md constraint 7). Entries older than 90 days are not stored (retention would remove them), at most 50 per fetch.
3. **Feed XML is read by a small in-repo reader** (`src/river/adapters/rss/xml.ts`), not a new dependency: it is lenient the way feed readers must be, it never expands entity declarations (a document that declares any is refused) or fetches DTDs, and it caps nesting and element counts on top of the guard's 2 MB body cap.
4. **PeerTube channels stay fediverse spaces.** For a space whose NodeInfo says `peertube`, an outbox Announce of a video on the channel's own host is read by fetching that Video (at most 20 per refresh, the same cap as boosts in spec 4.3) and, if the Video is attributed to the channel and public, stored as a `video` item keyed by the Announce's id. A PeerTube channel (a Group) has category `video`. Nothing changes for other servers.
5. **Allowed hosts, added to ADR-001's list** (every request through the fetch guard, unchanged):
   - the host of a feed URL or web page a member or the operator asks to follow, to read it once to resolve it, and the feed on every refresh (already ADR-001 item 1);
   - the hosts of at most three feed links that page names with `<link rel="alternate" type="application/rss+xml|application/atom+xml">`, to find the feed (new: "the hosts those sources point to for feeds");
   - a PeerTube channel's own host, for the Video objects its outbox announces (new: "and the Video objects a PeerTube channel announces").
   Media files (audio, video) are never fetched by the server; images load in the browser as ADR-005 says.
6. **No new seed.** Which real video channel and podcast the instance follows is Adam's choice; candidates are listed in `DECISIONS.md`. Seeds named there would be added to ADR-001's seed hosts when chosen.

## Alternatives considered

- **`fast-xml-parser` or another XML library:** well tested, but a new dependency tree on a security-sensitive input path, strict by default, and its entity handling needs configuring to be safe; a small lenient reader covers what feeds use.
- **Treat a PeerTube channel's Announces as ordinary boosts:** every video would be an empty "boosted a post" card, so the channel would be unreadable.
- **A separate `peertube` adapter:** PeerTube already speaks ActivityPub; the fediverse adapter resolves, pages and maps it, and only the announce-by-IRI step differs.
- **One adapter value per format (`rss`, `atom`, `podcast`):** the formats share one resolve and fetch path; `network` (`rss` or `atom`) and `category` (`podcast`, `video`, `publication`) carry the difference.

## Consequences

- Members can follow most of the web's blogs, news sites and podcasts, and PeerTube channels read as video spaces.
- The CHECK change is a schema change to an existing column (`needs-adam`). Code runs against the previous schema: until the migration lands, storing an `rss` space fails the CHECK and the follow box says "That kind of Space isn't supported yet".
- Feeds larger than the guard's 2 MB cap (some long-running podcasts) can't be read; raising the cap is a fetch guard change and would need its own decision.
- The follow box may now make one more request for an address that isn't a hub or an account (the feed adapter tries the URL last).
- Fixtures for M12 are synthetic (the thread that built it could not reach real hosts); real recordings replace them once seeds are chosen (`npm run record-fixtures -- --media <address>`).
