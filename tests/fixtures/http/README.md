# Recorded HTTP responses

Real responses from the seed hosts, keyed by their real `https://` URLs. Re-record only when told
to, with `npm run record-fixtures`. Tests never call outside hosts.

## Format (set by the fetch guard, `src/shared/fetch/fixtures.ts`)

One JSON file per request, at `<host>/<slug>-<hash>.json`:

```json
{
  "url": "https://demosville.civic.social/…",
  "method": "GET",
  "requestHeaders": { "if-none-match": "\"v1\"" },
  "status": 200,
  "headers": { "content-type": "application/json", "etag": "\"v1\"" },
  "body": "…"
}
```

`method` is left out for GET. `requestHeaders` is optional: a fixture that has it answers only
requests that carry those headers, so a 304 for `If-None-Match` can sit next to the 200. Recorders
write files with `saveFixture(dir, await fixtureFromResponse(response, request))`, which drops
cookies and connection headers.

## Replay

- **API and e2e tests:** `FETCH_FIXTURES_DIR=tests/fixtures/http` makes `getFetchGuard()` replay
  these files through the real guard. URL and address checks still run; a recorded host resolves
  to a stand-in public address that is never connected to. An unrecorded host fails as
  `unresolvable_host`; an unrecorded path on a recorded host fails as `no_fixture`. The app refuses
  to start with this variable on Vercel.
- **Unit tests:** build a guard with
  `createFetchGuard({ dispatcher: mockAgentFromFixtures(fixtures), resolver: fixtureResolver(fixtures) })`,
  or `replayOptions(dir)`, and pass it to the code under test.

## Fediverse (M4)

Recorded on 2026-10-21 by `scripts/recorders/fediverse.ts`, which runs the adapter itself through
a saving guard, so each file is a request the adapter really sends: WebFinger, the actor, NodeInfo
(well-known and document), the outbox, its first two pages, one boosted object where it lives on a
seed host, and Mastodon's REST lookup and statuses for `@eff@mastodon.social`.

Boost content (2026-10-22): `fetchNew` now fills boosts with the posts they boost (spec 4.3), so a
refresh of `@w3c@w3c.social` also reads boosted posts and their authors. The ones on seed hosts were
recorded then, by running the adapter through a guard that replayed everything already here and
fetched only the missing seed-host requests: seven more `w3c.social` statuses and the actors
`w3cdevs`, `caribou`, `p20n` and `tink`; on `mastodon.social`, PhilA's status, the 401 its actor
returns, and its `/api/v1/accounts/lookup` answer. `@swf@socialwebfoundation.org` embeds the posts
it announces; the fill re-reads them where they live, so thirteen `socialwebfoundation.org` posts
(`/?p=…`) and the author `/author/evanprodromou/` were recorded the same way. The live run hit
the fill's 8 s limit before the older ones, which stay unrecorded (the "embedded, not re-read"
case in replay). Boosts on other hosts (mas.to, indieweb.social,
mamot.fr, front-end.social, piaille.fr, sigmoid.social) are not recorded and fail in replay, which
is the "can't be fetched, keep the plain card" case. Seeds:
`@w3c@w3c.social`, `@wearenew_public@mastodon.social`, `@eff@mastodon.social`,
`@internetarchive@mastodon.archive.org`, `@wikipedia@wikis.world`, `@swf@socialwebfoundation.org`.

- mastodon.social answers unsigned actor reads with 401 (recorded as such) but serves outboxes;
  the adapter reads those profiles through `/api/v1/accounts/lookup`.
- Responses the seeds don't give (a 401/403 outbox, a 429, a post with `<script>`) are not in this
  folder. Tests derive them from a recorded response at run time (`tests/unit/helpers/fediverseFixtures.ts`).
- `fedizen.net` is not recorded: ADR-001 allows it only once Adam approves.

## Framing check (UI revisions 2)

Recorded on 2026-10-22 by `npm run record-fixtures -- --frames` (`scripts/recorders/frames.ts`),
which runs the River's framing check itself (`src/river/frame/check.ts`) through a saving guard:
one GET of each page with `Accept: text/html,application/xhtml+xml`. Only the headers matter to
the check; the bodies are kept as recorded.

- `socialwebfoundation.org/…/fosdem-2027-dev-room-application-is-in/`: the @swf seed's own
  article; no `X-Frame-Options`, no CSP, so it can be framed.
- `longmont.civic.social/meeting-summary/proc_4ebb11759c4c40ce`: a Civic Hub page; `X-Frame-Options:
  DENY` and `frame-ancestors 'none'`, so it opens in the reader.

Mastodon posts are framed through their `/embed` page and never checked, so nothing is recorded for
them; mastodon.social and w3c.social served `/embed` with neither header on 2026-10-22 (ADR-008).

## Bluesky (ADR-009)

Recorded on 2026-10-23 by `npm run record-fixtures -- --bluesky` (`scripts/recorders/bluesky.ts`),
which runs the Bluesky adapter itself through a saving guard that allows only ADR-009's hosts:
`com.atproto.identity.resolveHandle`, the DID document on `plc.directory`,
`app.bsky.actor.getProfile`, and two pages of `app.bsky.feed.getAuthorFeed`
(`filter=posts_no_replies`, 30 a page), all unauthenticated, from `public.api.bsky.app`.

- `@bsky.app`: a custom-domain handle (resolved by the AppView: its HTTPS well-known answers
  404, so it uses DNS). Its own posts with videos, images and quotes (one quoting a post that
  isn't available, one quoting a starter pack), and reposts of posts with images, video, link
  cards, quotes and a quote with media. Two reposted authors carry `!no-unauthenticated`.
- `@publicdomainrev.bsky.social`: a bsky.social handle, posts with images (one with alt text).
- `@wikipedia.org`: galleries (`app.bsky.embed.gallery`) with alt text, and videos.
- `did:plc:ewvi7nxzyoun6zhxrhs64oiz` (`@atproto.com`), followed by DID: link cards and quotes.
- `https://bsky.app/profile/publicdomainrev.bsky.social`: the same account as the handle.
- `@eff.org` for "Import from Bluesky": its handle, DID document and profile, and all three pages
  of `app.bsky.graph.getFollows` (100 a page; 259 accounts, 25 of them labelled
  `!no-unauthenticated`).

A handle's own `https://{handle}/.well-known/atproto-did` is not recorded: the AppView resolved
every recorded handle, and this sandbox's proxy refuses `*.bsky.social`. The unit tests derive
that case (and replies, adult labels, a 429, a takedown) from recorded responses at run time.

## SYNTHETIC: media sources (M12)

`synthetic-tube.example/` and `synthetic-podcast.example/` are **not recordings**. The M12 thread's
sandbox could not reach any PeerTube instance or podcast host (its egress proxy refused them and
their names did not resolve), so rather than guess at a real site's content these responses were
written by `scripts/synthetic-media-fixtures.ts` to the published formats, on hosts under the
reserved `.example` TLD (RFC 2606) that can never be real. Every file carries a `note` saying so.

- `synthetic-tube.example`: a PeerTube 7 channel, `@trail_films@synthetic-tube.example`
  (WebFinger, NodeInfo 2.0 naming `peertube`, the Group actor, its outbox whose items are
  Announces of the channel's own videos by IRI, and the three Video objects with `duration` as
  `PT{seconds}S`, thumbnails in `icon`, the watch page, HLS playlist and files in `url`, and a
  Markdown description).
- `synthetic-podcast.example`: an RSS 2.0 podcast with Apple's namespace (`feed.xml`: four
  episodes with `<enclosure>`, `itunes:duration` in three forms, one older than 90 days), the
  feed's 304 for its own ETag, and a home page that names the feed with
  `<link rel="alternate" type="application/rss+xml">`.
- Both answer `/.well-known/civic.json` with 404, as non-hub hosts do (the follow box asks the hub
  adapter first).

Regenerate with `npx tsx scripts/synthetic-media-fixtures.ts`. Record real sources, once Adam
picks them (DECISIONS.md, "Proposed real media seeds"), with
`npm run record-fixtures -- --media <feed URL, page URL or @channel@server>`, then retire these.
