# Mosaic River v1 Build Spec

2026-10-20 · Adam (approved 2026-10-20)

Draft 3. Draft 2 fixed what an independent engineering review found when it checked draft 1 against the Civic Hub's code and live feeds; draft 3 adds email recovery and Adam's answers to the open items. It builds Mosaic River v1 as two apps in `Mosaic-Foundation/river` (AGPL-3.0): the River at river.mosaic.social and an identity host at id.mosaic.social. Decisions come from the Mosaic River Decisions Log and the Phase 2 architecture doc; the mockups canvas is a starting point for layout.

## 1. Goal

Build a working, non-production demo of **Mosaic River**, a person's decentralized inbox. A person follows Spaces (Civic Hubs, fediverse accounts, later other Mosaic spaces) and reads them in one newest-first feed they control, filtered by circle, content type and mode. Each item links back to where it lives.

Two deployable apps in one repo:

- **River**, `https://river.mosaic.social`: feed, filters, Following page, modes (Everything, Civic), plugin panel.
- **Identity host**, `https://id.mosaic.social`: passkey sign-up and sign-in, one `did:webvh` per person with a custodial key, and the sign-in redirect the River uses.

Done when a visitor sees live items from three real Civic Hubs and six fediverse accounts plus labelled sample entries; a person can sign up with a passkey (creating their DID), follow and mute spaces and streams, organize circles, filter by circle and content type, and switch to Civic mode with its panel. Runs on Vercel Hobby and one free Supabase project.

Primary use case: an individual's personal feed. Organizational Rivers are possible later through the instance model; only `river.mosaic.social` is live in v1.

## 2. Users and flows

**Users**

- **Visitor** (not signed in): sees the instance's default River (seed follows and default circles, read-only). Can filter and search. Read state lives only in the browser. Follow, mute and circle editing ask the visitor to sign up.
- **Member** (signed in): own follows, circles, read state and preferences, linked to their DID.
- **Operator** (Adam): edits instance config and seeds through migrations and a seed script. No admin UI.

**F1. First visit.** The River resolves the instance from the hostname, loads the default mode and seed follows, refreshes stale sources within the time budget (4.5), and shows items newest first. Each card shows the source icon (avatar, or initials), source name, kind label, relative time, a **Live** label (real source) or **Sample** label (seeded demo entry), title if any, text, media if any, and an "Open on {host}" link labelled by the item URL's host (hub announcements can link off-hub). Sample cards have no Open link; clicking **Sample** shows: "This isn't linked to a real feed. It's here to show how the River works for a soccer club, a family or a podcast."

**F2. Sign up.** "Sign up" redirects to the identity host's authorize page (4.6). The person enters an email address (for recovery) and creates a passkey. The identity host creates a person, an Ed25519 key and a `did:webvh` (`portable: true`) at `id.mosaic.social/u/{code}`, then redirects back with a signed note. The River verifies it, creates an account, links the DID, copies the instance's seed follows and default circles, and sets a session cookie.

**F3. Sign in.** Same redirect with an existing passkey (discoverable credential; no username typed). The River finds the account by (instance, DID SCID).

**F4. Read.** Newest first; unread dot; "Mark read"; "Mark all read" for the current view; opening a link marks the item read. Links open in a new tab with `rel="noopener noreferrer"`.

**F5. Filter.** Desktop: all filters in the left column (search, circles, content type). Phone: a chip row. Circle (one at a time, "All" default) AND content type (All, Posts, Articles, Podcasts, Videos, Photos, Events, Civic activity) AND the mode's scope. Search matches title, text and source name of stored items. Empty result: "Nothing of that type in this circle yet."

**F6. Follow something** (members). One box accepts a URL or `@name@server`. The River resolves it (4.2, 4.3) and previews name, icon and kind. When the URL points at a single hub process, it offers "Just this stream (ends on its own when the process ends)" or "The whole space". The member picks circles and confirms. Errors: "We couldn't reach that address", "That address isn't a Space we can follow", "This address can't be followed" (fetch guard), "This server only shares posts with other servers" (4.3).

**F7. Following page** (members). Spaces grouped by kind, collapsed. A space with stream rules expands to its streams (Following or Muted, "until the process ends"). Actions: unfollow, mute or unmute a stream, follow a single stream. Tabs: **Spaces**; **Quiet** (followed spaces with no new item in 90 days; banner offers "Unfollow all quiet spaces"); **Ended** (streams whose process ended; cleared after 90 days). The most specific rule wins: a muted stream stays hidden inside a followed space; a followed stream shows even if its space is not followed.

**F8. Circles** (members). Create, rename, recolor, delete; add or remove spaces. A space can be in several circles. Circles work in every mode. One circle per account carries `role = civic` (seeded as "Civic"); renaming it keeps the role.

**F9. Modes.** The switch shows the instance's enabled modes. Civic mode shows items from spaces with category `civic` plus members of the account's `role = civic` circle, uses the Civic theme, and shows the panel: **Coming up** and two placeholder slots ("Your representatives", "Elections and ballot") naming the data sources they wait on. Config can enable only Civic and hide the switch.

**F10. Sign out.** Clears the River session.

Phone (390 px) supports every flow: header with mode picker, search and Follow; chip row for content type and circles; compact cards; bottom tabs Feed, Circles, Following, You.

## 3. Data model

One Supabase Postgres project, two schemas: `river` and `identity`.

**Access.** Both apps use `pg` (node-postgres) through Supabase's Supavisor transaction pooler (port 6543), as ADR-005 already does for the hub import, with two LOGIN roles: `river_app` and `identity_app`. Neither role has BYPASSRLS. Each has USAGE and table grants only on its own schema. Neither schema is exposed through Supabase's Data API. Each request runs in `BEGIN; SELECT set_config('app.instance_id', $1, true), set_config('app.account_id', $2, true); …; COMMIT`. RLS policies compare against `current_setting('app.instance_id', true)` and `current_setting('app.account_id', true)`. Every table has `ENABLE` and `FORCE ROW LEVEL SECURITY`. Wrappers `forInstance()` and `forAccount()`, in the style of the hub's `forHub(currentHubId())`, open the transaction, set the settings, stamp ids on insert, and refuse a payload carrying another instance's or account's id. Shared public tables (`spaces`, `streams`, public `items`) allow read to `river_app` regardless of account.

**Roles and passwords.** SET cannot take bind parameters, so ids are never spliced into SQL text. A migration creates `river_app` and `identity_app` as NOLOGIN roles with their grants, idempotently (a `DO` block with `IF NOT EXISTS`); no password ever goes in a migration. Locally and in CI, `supabase/seed.sql` (applied by `npx supabase db reset`, never by `db push`) runs `ALTER ROLE … LOGIN PASSWORD 'local-only'`. On the hosted project Adam runs the same statement once in the SQL editor with a generated password. Through the shared pooler the username is `[role].[project-ref]` and port 6543 is transaction mode ([Supabase: connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)). Transaction mode keeps `SET LOCAL` inside the request's transaction but does not support prepared statements, so code never passes a `name` to node-postgres queries.

### 3.1 River schema

| Table | Columns and constraints |
| --- | --- |
| instances | `id`, `hostname` (unique), `name`, `theme` (mosaic, civic), `modes_enabled` (text\[\]), `default_mode`, `seed_follows` (jsonb: url, stream\_key?, circles\[\]), `default_circles` (jsonb: name, color, role?, members\[\]), `plugins` (jsonb), `created_at` |
| accounts | `id` (uuid), `instance_id`, `display_name`, `created_at` |
| login\_methods | `id`, `instance_id`, `account_id`, `kind` (did in v1), `did`, `scid`, `created_at`, `last_used_at`. UNIQUE (instance\_id, kind, scid): one DID can hold an account on each instance; the SCID finds the same account after a move |
| auth\_attempts | `state` (PK), `instance_id`, `nonce`, `created_at`, `used_at`. The sign-in callback consumes a row atomically |
| spaces (shared) | `id`, `adapter` (civic\_hub, fediverse, sample, rep\_space\_v01, atproto), `canonical_url` (unique), `feed_url`, `actor_id`, `network`, `category` (civic, news, publication, club, family, neighborhood, podcast, video, person, organization), `name`, `icon_url`, `home_url`, `manifest` (jsonb, incl. cached actor with expires\_at), `etag`, `etag_url`, `newest_item_at`, `last_fetched_at`, `fetch_lock_until`, `fetch_status` (ok, error, blocked), `error_count`, `last_error` |
| streams | `id`, `space_id`, `key` (`https://{host}/process/{id}`), `title` (from first Create civic:Process), `status` (open, ended), `ended_at`, `last_checked_at`. UNIQUE (space\_id, key) |
| items (shared when public) | `id`, `space_id`, `stream_key`, `source_id` (activity IRI), `kind` (post, article, podcast, video, photo, event, civic), `published_at`, `title`, `summary`, `content_html` (sanitized), `url` (null for samples), `author`, `media` (jsonb: type, url, alt, duration, width, height), `boost_of`, `audience` (public in v1), `account_id` (reserved), `civic` (jsonb: activity type, object type, process type, process IRI, terminal state, place code, deadline), `is_final_result`, `hidden`, `raw`, `fetched_at`, `search` (generated tsvector). UNIQUE (space\_id, source\_id); indexes (space\_id, published\_at DESC), (space\_id, stream\_key), GIN on search |
| follows | `id`, `instance_id`, `account_id`, `space_id`, `stream_id` (nullable), `rule` (follow, mute), `ends_with_stream`, `ended_at`, `created_at`. UNIQUE NULLS NOT DISTINCT (account\_id, space\_id, stream\_id) |
| circles | `id`, `instance_id`, `account_id`, `name`, `color`, `role` (civic or null), `sort` |
| circle\_members | `instance_id`, `circle_id`, `space_id`; PK (circle\_id, space\_id) |
| read\_state | `instance_id`, `account_id`, `item_id`, `read_at`; PK (account\_id, item\_id); FK to items ON DELETE CASCADE |
| preferences | `instance_id`, `account_id`, `key`, `value` (jsonb); PK (account\_id, key) |

**Retention** (daily job, 4.5): delete items older than 90 days except `is_final_result` items of streams any account followed, and except sample items. Delete follows whose `ended_at` is older than 90 days. Sample spaces are exempt from Quiet. Modes are configuration in v1 (built-in definitions in code plus `instances.modes_enabled`).

### 3.2 Identity schema

| Table | Columns and notes |
| --- | --- |
| people | `id`, `code` (8 random lowercase base32 characters, unique), `did`, `scid`, `display_name`, `webauthn_user_id` (32 random bytes, not the code or DID), email (required, unique), email\_verified\_at, `created_at` |
| passkeys | `id`, `person_id`, `credential_id` (unique), `public_key`, `counter`, `transports`, `created_at`, `last_used_at` |
| did\_log | `person_id`, `version_number`, `entry` (one JSON line), `created_at`. Append-only, written in one transaction with a row lock on the person; did.jsonl is these entries in order |
| keys | `id`, `person_id`, `kid`, `public_jwk`, `private_key_ciphertext`, `wrapped_dek`, `created_at`, `retired_at`. AES-256-GCM per-person data key wrapped by a master key held only in the identity app's secrets; the DID is the additional authenticated data |
| clients | `client_id` (origin), `redirect_uris` (exact list), `name`. Not stored in the database: built at startup from RIVER\_CLIENT\_ORIGINS, each origin with its /api/auth/callback path, so no migration hard-codes a host |
| auth\_requests | `id`, `client_id`, `redirect_uri`, `state`, `nonce`, `webauthn_challenge`, `expires_at` (10 minutes), `used_at` |
| audit\_log | `person_id`, `action` (did\_created, key\_used, passkey\_added, signin), `at`, `detail` |

**recovery\_tokens**: `id`, `person_id`, `token_hash` (SHA-256 of a 32-byte random token; the token itself is never stored), `purpose` (verify\_email, recover), `expires_at` (15 minutes for recover, 24 hours for verify\_email), `used_at`. Email addresses live only in the identity schema; the River never receives them.

### 3.3 Export (API in v1, screen later)

`GET /api/me/export` (members) returns:

```json
{
  "format": "mosaic-river-export",
  "version": 1,
  "exported_at": "…",
  "did": "did:webvh:…",
  "follows": [{ "url": "…", "stream_key": null, "rule": "follow", "circles": ["Civic"] }],
  "circles": [{ "name": "Civic", "color": "#2F6FA8", "role": "civic" }],
  "preferences": {}
}
```

## 4. Sources and protocols

### 4.1 Item model and adapters

Every adapter turns a source's objects into items (3.1): Civic Hub (AS2), fediverse (ActivityPub), sample entries, and stubs for the Representative Space v0.1 envelope and atproto (interface plus a "not supported yet" error). Each adapter has `resolve(input) -> SpacePreview` and `fetchNew(space) -> Item[]`, and fixture tests built from recorded real responses.

### 4.2 Civic Hub adapter

**Resolve.** From any URL on a hub host, `GET https://{host}/.well-known/civic.json`. Read `name`, `space.id` (a `did:web`), `space.type` (`civic.hub` gives category `civic`), `feeds[0]`, optional `jurisdictions`, optional future `icon` (else the initials of `name`). A host answering `{"code":"no_hub"}` gets "That address isn't a Space we can follow".

**Streams.** To map a hub UI URL to a stream, take the path segment matching `proc_[0-9a-f]+` from `/process/{id}`, `/meeting-summary/{id}`, `/project/{id}`, `/brief/{id}` or `/announcement/{id}`. The stream key is `https://{host}/process/{id}`: the hub's `context.id` is always this form (`civic-hub/src/events/activitySerializer.ts:734-753`), while item `url`s often differ. Validate with `GET {feed}?page=true&context={key}&limit=1`.

**First fetch.** `GET {feed}?page=true&limit=50&since={now minus 90 days}`. Follow `next` for at most 5 pages. Pages can hold fewer items than `limit` and still carry `next` (`eventController.ts:275-277`); keep following within the cap. Persist each page as it arrives.

**Refresh.** `since = newest_item_at minus 14 days` (hub `since` filters on the event's own `created_at`, `eventStore.ts:254`, and news sync backdates announcements), dedupe on (space\_id, source\_id), at most 3 pages. Send `If-None-Match` only when the stored `etag_url` equals the exact request URL; a 304 keeps existing items.

**Map.** `id` to `source_id`; `published` to `published_at`; `url` to item URL; `context.id` to `stream_key`; `object.name` to title, else the stream's title; `location["civic:code"]` to place code; `hub:payload.voting_closes_at` to `civic.deadline`. Items not addressed to `https://www.w3.org/ns/activitystreams#Public` are skipped. Per-type text comes from named `hub:payload` keys (`result_summary`, `meeting_summary.meeting_title`, `outcome_description`, `participant_count`), defined in one file, `hubTemplates.ts`, with a fixture test per template.

**Which hub activities show.** Closed by default: anything not listed is stored with `hidden = true`. Rows are keyed by activity type, object type and `civic:processType` when it matters, from the hub's mapping table (`activitySerializer.ts:272-451`).

| Activity | Object | Shown as |
| --- | --- | --- |
| Create | civic:Process | A process opened (kind civic) |
| civic:Start | civic:Process | A process started |
| civic:End | civic:Process | A process ended |
| civic:End | civic:Proposal | A proposal closed |
| civic:End | hub:Project | A project archived |
| Announce | civic:Result | Results published (final-result candidate) |
| Announce | civic:Outcome | An outcome delivered |
| Announce | hub:SupportThreshold | A proposal reached its support threshold |
| Create | civic:Proposal | A proposal submitted |
| Create | civic:Outcome | An outcome recorded (final-result candidate) |
| Create | hub:Aggregation | Results summarized (votes, briefs, meeting summaries; meeting summaries use kind article) |
| Create | hub:OfficialResponse | An official responded |
| Create, Update | hub:Project | A project created or updated |
| Offer | hub:ProposedProcess | A process proposed |

Hidden: ballots, Like and Undo support signals, comments, review steps (Accept, Reject, TentativeReject, review Updates), plain process Updates, submissions. The table lives in one file with a test per row.

**Stream end.** On `civic:End` for a stream's context, set the stream `status = ended`, `ended_at = now`. The stream stays readable for 7 days so the results that follow (aggregation, then result) still arrive. The kept final item is the last `Announce civic:Result` or `Create civic:Outcome` for that context, falling back to the End; mark it `is_final_result`. Then set `ended_at` on follows with `ends_with_stream = true`, which moves them to Ended.

**Withdrawn processes.** The hub stops serving archived or pending-review processes (`eventController.ts:270-285`). At most once a day per stream, during refresh (4.5), for streams with no new item in 7 days, `GET {feed}?page=true&context={key}&limit=1`; if empty, hide that stream's items.

Hubs send no CORS headers, so all fetching is server-side.

### 4.3 Fediverse adapter

**Resolve.** Handle: `GET https://{server}/.well-known/webfinger?resource=acct:{name}@{server}`, take the `rel=self` link of type `application/activity+json`. Profile URL: `GET` it with `Accept: application/activity+json`. Read the actor's `name`, `preferredUsername`, `icon.url`, `url`, `outbox`, `type` (Person to person; Organization, Group, Service to organization). Read NodeInfo for `network`. Cache the actor in `spaces.manifest` for 24 hours.

**Fetch.** Read the outbox's `first` page (`?page=true` on Mastodon) and stop at the first already-known `source_id`, at most 2 pages. Do not use `min_id`: it is Mastodon-specific, and WordPress ActivityPub (`@swf@socialwebfoundation.org`) pages differently.

**Map.** Only items whose `to` includes `as:Public`. Replies are hidden. Create Note becomes `post`, or `photo` when it has at least one attachment and all are images; Article and Page become `article`; Video `video`; Audio `podcast`; Event `event`. Announce becomes a boost card. During the refresh the boosted object is fetched through the fetch guard, then its author's actor (on a 401 or 403, Mastodon's `/api/v1/accounts/lookup` for the name in the actor URL, accepted only when its `uri` is that actor), at most 20 dereferences per source per refresh, newest boost first; a PeerTube channel's own videos share the same 20. The object must be public and served from the host its id names, and its author must be on that host. The boost item keeps the Announce's id, time and actor (`author`) and takes the object's kind, title, summary, content, media and URL; the original author goes in `boost_of.author` (name, handle, url, avatar). A boosted public reply is shown. Cards and the reader view show the original author's name and avatar, the post's content and media, and a small "{actor} boosted" line above; the reader's title is the original post's ("Post from {author}" when it has none). When the object can't be fetched (deleted, private, refused, unreachable, or past the budget), the card stays "{actor} boosted a post from {host}". Attachments go to `media` with `alt` from `name`. Content is sanitized (Appendix B).

**Fallback.** When an unsigned outbox read returns 401 or 403 and NodeInfo says Mastodon, use `/api/v1/accounts/lookup?acct=` then `/api/v1/accounts/{id}/statuses?limit=20&exclude_replies=true`. Otherwise mark the space `blocked`: "This server only shares posts with other servers. The River will be able to read it once it has its own fediverse address."

**Limits.** Mastodon allows about 300 unauthenticated requests per 5 minutes per IP ([Mastodon rate limits](https://docs.joinmastodon.org/api/rate-limits/)), and Vercel's outbound addresses are shared. Back off on 429 using `Retry-After`; never refresh a fediverse space more often than every 120 s. No actor, inbox or HTTP signatures in v1.

### 4.4 Sample entries

Seeded by a script with no network: sample spaces (`adapter = sample`) for a soccer club, a family circle (photos), a local publication, a neighborhood association (event), an issue campaign, a podcast (episode, duration) and a video channel (duration). Dates are stamped relative to `now()` at seed time and re-stamped by the daily job. Media are local placeholder images in the repo. Samples have no URL and are exempt from retention and Quiet.

### 4.5 Refresh on open, and the daily job

`GET /api/feed?mode=&circle=&type=&q=&cursor=` returns items for the visitor's or member's follows, refreshing stale spaces first:

- Claim each stale space with one statement: `UPDATE spaces SET fetch_lock_until = now() + interval '20 seconds' WHERE id = $1 AND coalesce(fetch_lock_until, '-infinity') < now() AND coalesce(last_fetched_at, '-infinity') < now() - interval '120 seconds' RETURNING id`. Only claimed spaces are fetched.
- Fetch claimed spaces in parallel. Each request times out at 6 s, with no retry inside a request. Fetches still running when the 6 s response budget ends continue under `waitUntil` (`@vercel/functions`). The lock is released and `last_fetched_at` set in `finally`.
- The response returns what is stored; items from slow sources appear on the next open.

One daily job, `pg_cron` on Supabase (SQL in a migration), runs at 04:17 UTC: retention (3.1), clearing Ended follows older than 90 days, deleting `auth_attempts` and `auth_requests` older than 1 day, and re-stamping sample dates. The `pg_cron job is SQL only and makes no network calls. The withdrawn-process check (4.2) runs during refresh instead: a stream with no new item for 7 days and not checked in the last day is probed then`.

### 4.6 Identity host and River sign-in

**Passkeys.** `@simplewebauthn/server` and `@simplewebauthn/browser` v14 (MIT). RP ID `id.mosaic.social`, RP name "Mosaic ID". `residentKey: 'required'`, `userVerification: 'required'`, empty `allowCredentials` on sign-in, `user.id` = the person's random `webauthn_user_id`. Each ceremony's challenge is stored on the `auth_requests` row, and the row is marked used before anything is signed. `/authorize` and sign-up are rate-limited per IP.

**DID.** `did:webvh` v1.0 via `didwebvh-ts` (pin an exact version after confirming its LICENSE, Node 24 support and whether 3.0.0 is released; it must work with npm workspaces). DID form `did:webvh:{SCID}:id.mosaic.social:u:{code}`; log served at `https://id.mosaic.social/u/{code}/did.jsonl` with `Content-Type: text/jsonl`. First entry sets `method: "did:webvh:1.0"` and `portable: true`. The person's Ed25519 key is the update key and the `authentication` method `#key-1`.

**Email recovery.** Sign-up requires an email address and sends a verification link; the account works before the link is clicked, with a reminder until it is. Mail goes through Resend (free tier: 3,000 emails a month, 100 a day, per [Carly's Resend pricing review](https://www.usecarly.com/blog/resend-pricing/), checked 2026-10-02). "Lost your passkey?" on the authorize page takes an email address and always answers "If that address has an account, we sent a link", so the page does not reveal who has one. For a verified address it sends a single-use link valid for 15 minutes. The link lets the person register a new passkey on the same person and DID, then continues the sign-in; existing passkeys stay until removed. Each recovery is written to `audit_log` and triggers a notice email to the address. Rate-limited per IP and per address. Recovery never exposes or changes the DID key. Trade-off: whoever controls the email account can take over the Mosaic account; key-custodian or social recovery can replace this later.

**Change email.** A signed-in person can change their address after a fresh passkey check. The new address gets a verification link and becomes the recovery address only once verified; the old address gets a notice. Losing both the passkeys and the email means losing the account in v1.

**Recovery update key.** Every DID's `updateKeys` lists two keys: the person's custodial key and a Mosaic recovery key whose private half is kept offline by Adam, never on any server. did:webvh allows several update keys, and any one of them may authorize a log entry ([did:webvh v1.0](https://identity.foundation/didwebvh/v1.0/)). The identity host knows only the recovery key's public half (`IDENTITY_RECOVERY_PUBLIC_KEY`). If the master key or a person's custodial key is ever lost, Adam runs `npm run recover-dids` on his own machine with the private recovery key: it creates a new custodial key for each affected person and appends a log entry, signed by the recovery key, that makes the new key the update and authentication key. The DID, the River account and the person's passkeys and email stay the same, so they sign in as before. When a person later takes custody of their own key, they can remove the Mosaic recovery key from their DID.

**Sign-in note** (v1; replace with an atproto-style OAuth profile before any third-party site relies on it):

1. River creates an `auth_attempts` row (state, nonce), sets a 10-minute HttpOnly, Secure, SameSite=Lax cookie holding the state (so a callback only completes in the browser that started it), and redirects to `https://id.mosaic.social/authorize?client_id=https://river.mosaic.social&redirect_uri=https://river.mosaic.social/api/auth/callback&state={state}&nonce={nonce}`.
2. The identity host checks `client_id` and the exact `redirect_uri` against `clients`, stores an `auth_requests` row with a fresh WebAuthn challenge, verifies the passkey assertion (or registration) against it, marks the row used, and redirects to `redirect_uri?state={state}&note={jws}`.
3. `note` is a compact JWS: `alg: EdDSA`, header `kid: {did}#key-1`, payload `{iss: did, sub: did, aud: client_id, nonce, iat, exp: iat + 120}`, signed with the person's key.
4. River callback: require the state cookie to equal `state`, then consume the `auth_attempts` row atomically (fail if missing or used); require `iss == sub` and `kid` to start with that DID; accept only DIDs whose host is in `TRUSTED_DID_HOSTS` (v1: `id.mosaic.social`); resolve the DID through the fetch guard, not the library's built-in fetch, with a 10-minute cache; verify with `alg` fixed to EdDSA and the key from the resolved document's `authentication`, ignoring any key in the header; check `aud` equals the River's origin, `nonce` equals the attempt's, `iat` not in the future and `exp` not passed, with 60 s leeway. On success: session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, 30 days), account found or created by (instance\_id, kind, scid). The callback sets `Referrer-Policy: no-referrer` and redirects to `/` at once so the note does not linger.

The identity host never returns private keys; each signature is written to `audit_log`.

### 4.7 Modes and plugins

- Modes: `everything` (all follows, no panel, Mosaic theme) and `civic` (category civic spaces plus the `role = civic` circle; Civic theme; panel shown).
- Plugin manifest, same family as Civic Hub plugins: `{ id, kind: "view", version, surfaces: ["river.panel" | "river.mode-header" | "river.card-action"], title, capabilities: ["read:items"] }`. First-party plugins only, bundled at build time; each receives read-only access to the current view's items through a typed API and nothing else.
- v1 plugins: **Coming up** (up to 5 upcoming dates from the current items' `civic.deadline` and event start times, in date order; hidden when there are none) and two placeholder slots naming the data sources they wait on (Open States, Geocodio or Cicero; Democracy Works or Ballotpedia).

### 4.8 Images

Loaded in the browser straight from the source: `loading="lazy"`, `referrerpolicy="no-referrer"`, HTTPS only. No spinners; an image that fails to load is removed and the card renders without it. No content-warning blur. The River builds no link previews.

## 5. Out of scope for v1

- Posting, replying, liking or boosting from the River. Later idea: a setting that links a person's Mastodon account so replies from the River come from that account.
- A River ActivityPub actor, inbox, push delivery or HTTP signatures.
- atproto (stub adapter) and the Representative Space v0.1 adapter (stub).
- Discovery or a directory of spaces.
- River-built link previews; an image proxy or thumbnail service.
- Export and import screens (the export API is in scope).
- Person-made modes, third-party plugins, plugin sandboxing.
- Wallet login (OpenID4VP), credentials, credential-gated content (only the `audience` field and reserved `account_id` exist).
- Sign-in with DIDs hosted anywhere other than id.mosaic.social.
- Account recovery beyond email (key custodians, social recovery); a screen for managing several passkeys.
- Member views of hubs and any Civic Hub change (CORS for public feeds, `icon` field, follow button, DID sign-in, a `recorded_at` cursor).
- Real representatives, ballot or election data.
- Content-warning handling; fediverse replies and non-public posts.
- An admin UI, organizational instances beyond the seed row, custom domains, billing.
- Email, notifications, native apps.
- An RSS or podcast adapter, and real video or podcast seeds (stretch M12).
- Production backups, uptime monitoring and error tracking beyond Vercel's defaults.

## 6. Acceptance checks

Vitest for unit and integration; Playwright for end to end. Fixture tests replay recorded real responses (Demosville, Floyd, Longmont, `@w3c@w3c.social`) through undici's `MockAgent`, keyed by their real `https://` URLs, with an injected DNS resolver (Appendix B); they run in CI. Tests tagged `@live` hit the real hubs and fediverse accounts. They run only through npm run test:live, on Adam's machine or in an on-demand thread, never in ci, because the template keeps outside services out of the test suite. Timing checks use fake timers.

1. A visitor at `/` sees at least one Live item from each seed hub and at least five Sample items, newest first.
2. Every card shows source name, kind label, relative time, and exactly one of Live or Sample.
3. Clicking a Sample label shows the F1 explainer; Escape closes it.
4. Live cards have an "Open on {host}" link to the item URL, with `target="_blank"` and `rel` containing `noopener`; Sample cards have no Open link.
5. Choosing circle "News and ideas" (from `default_circles`) and type "Podcasts" shows only the sample podcast episode; a combination with no matches shows the empty-state text.
6. Searching a word from a fixture item's title returns that item and no unrelated item.
7. Civic mode shows only civic-category items and members of the `role = civic` circle, uses the Civic theme, and shows the panel with Coming up listing fixture `voting_closes_at` dates in date order, plus the two placeholders.
8. An instance with `modes_enabled = ["civic"]` hides the mode switch and opens in Civic mode.
9. Sign-up with Playwright's virtual WebAuthn authenticator (Chromium) creates a passkey, a person and a DID; the served did.jsonl has `Content-Type: text/jsonl`, verifies with the library's log verification, and its first entry has `portable: true` and `method: "did:webvh:1.0"`.
10. After sign-up the account has a did login method whose SCID matches; seed follows and default circles (including the civic-role circle) are copied; the session cookie has `HttpOnly`, `Secure`, `SameSite=Lax`.
11. The River callback returns 401 and creates no session for: wrong `aud`; expired `exp`; `iat` in the future; unknown or already-used `state`; a state cookie that is missing or different; mismatched `nonce`; signature by a different key; `kid` naming another DID; a DID on a host not in `TRUSTED_DID_HOSTS`; `alg` other than EdDSA.
12. The identity host rejects an authorize request whose `redirect_uri` is not an exact registered match, and a passkey assertion whose challenge does not match the stored request.
13. Following `https://demosville.civic.social` (fixture) previews the hub's name and initials icon; confirming shows its items.
14. Following a Longmont meeting-summary URL with "Just this stream" resolves to `https://longmont.civic.social/process/{id}` and shows only that process's items.
15. Following `@w3c@w3c.social` (fixture WebFinger, actor, outbox) previews name and avatar; confirming shows its posts, with boosts as boost cards and replies hidden.
16. With the injected resolver, each is refused with "This address can't be followed" and makes no request: `http://example.org`; `https://localhost`; `https://127.0.0.1`; `https://10.0.0.5`; `https://169.254.169.254`; `https://[::1]`; `https://[::ffff:127.0.0.1]`; a hostname resolving to a private address; a redirect to a private address; a redirect to `http:`.
17. Muting a stream inside a followed space hides its items; following a stream in an unfollowed space shows only that stream.
18. Fixture sequence End, then Aggregation, then Result for a followed stream: all three arrive; the Result is marked `is_final_result`; the stream shows in Ended and no longer under Spaces; the Result survives a retention run with the clock advanced 120 days.
19. A followed space whose newest item is older than 90 days appears in Quiet; "Unfollow all quiet spaces" removes those follows; sample spaces never appear in Quiet.
20. With one mock source delayed 30 s (fake timers), the feed responds within the 6 s budget plus 500 ms with the other sources' items; that space shows a quiet error note on Following after its fetch times out; no loading indicator remains.
21. A card whose image fails to load renders without it and without a broken-image icon.
22. A fixture post with `<script>`, an `onerror` attribute and a `javascript:` link renders without them; Mastodon's `invisible` and `ellipsis` spans keep their classes.
23. A member's "Mark read" persists across reload; a visitor's read state is browser-only and causes no server write.
24. Two members following the same space within 120 s cause one upstream fetch (counted in `MockAgent`).
25. Hub paging: first fetch sends `since` 90 days back and stops at 5 pages; a short page with `next` is followed; refresh sends `since` = newest minus 14 days, sends `If-None-Match` only for the same URL, and a 304 keeps existing items.
26. An unknown hostname gets a 404 page; river.mosaic.social and any host listed in `INSTANCE_HOST_ALIASES` (localhost, the River's vercel.app hosts until DNS is set), and every host on a Vercel preview deployment (`VERCEL_ENV=preview`), get the seed instance and the Mosaic theme.
27. Running as `river_app` (never `postgres`), member A's queries never return member B's follows, circles, read state or preferences; `river_app` cannot read the identity schema.
28. `keys.private_key_ciphertext` never contains a parseable private key; no identity API response contains private key material.
29. `GET /api/me/export` returns JSON matching 3.3 for a member and 401 for a visitor.
30. At 390 px there is no horizontal page scroll; bottom tabs are visible; circle and content-type filters are reachable.
31. axe reports no critical or serious issues on the feed, Following and sign-in pages; every control is keyboard-reachable.
32. `@live`: Demosville, Floyd and Longmont feeds parse with zero adapter errors and each renders at least one item; `@w3c@w3c.social` renders at least one post.
33. A withdrawn process (fixture: `?context=` returns empty) has its items hidden after the daily check.
34. Performance report (manual, not a gate): `GET /api/feed` time with 20 follows and a warm cache.

Added in draft 3:

35. Sign-up without a valid email address is refused; the verification link marks the address verified, works once, and fails after 24 hours.
36. Recovery: for a verified address, the emailed link (captured by a test mailbox) lets a new virtual authenticator register a passkey on the same DID and sign in to the same River account; an expired or used link fails; an unknown address shows the same message and sends nothing; the River database contains no email address.

37) Every new DID log's first entry lists exactly two update keys, the person's and `IDENTITY_RECOVERY_PUBLIC_KEY`. With a test recovery key pair, `recover-dids` for one person appends a log entry signed by the recovery key; the log still verifies; the person signs in to the same River account with the same passkey; the SCID is unchanged.

## 7. Build order

One PR per milestone, small commits inside each; a PR merges only with its checks passing.

| Milestone | Scope | Checks |
| --- | --- | --- |
| M0. Scaffold and deploy | The greenfield template already provides Express + Vite, CI, Vercel and the HANDOFF/ADR files. Add: `src/river/`, `src/identity/`, `src/shared/`; the `APP` switch in `src/app.ts`; `npm run dev:identity` (:3001); the `identity/` folder with its own `vercel.json` and `api/index.ts`; a `pg` pool in `src/db/` replacing the template's supabase-js `getDb()`, with lint allowing `pg` only under `src/db/`; `.env.example`; CI starting the identity server and passing `DATABASE_URL`; `npx supabase init` (`supabase/seed.sql` arrives in M1 with the roles; seeding a role that doesn't exist yet would fail CI); theme files `ui/src/styles/themes/mosaic.css` and `civic.css` (Appendix A) | CI green, previews live |
| M1. Schemas and access | Roles (idempotent), supabase/seed.sql with the local-only passwords, migrations, RLS with FORCE, the seed instance, `forInstance()` and `forAccount()` with tests | 27 |
| M2. Fetch guard | Port of the hub's `ssrfGuard.ts` with injectable resolver and dispatcher | 16 |
| M3. Civic Hub adapter | Item model, adapter, allowlist table, `hubTemplates.ts`, sanitizer, stream mapping and end handling, recorded fixtures | 22, 25, 18 (adapter part) |
| M4. Fediverse adapter | WebFinger, actor, outbox, NodeInfo, REST fallback, boosts; record a fixture from a public Fedizen (Bonfire) account and, if it reads cleanly, add that account as a seed | 15 (adapter part) |
| M5. Feed API and daily job | Samples seed, refresh on open with locks and `waitUntil`, filters with visitor circles from `default_circles`, search, pg\_cron job | 1, 2, 5, 6, 20, 23 (visitor), 24, 33 |
| M6. River UI | Everything mode, desktop and phone, starting from the mockups; Live and Sample labels; images | 3, 4, 21, 26, 30, 31 |
| M7. Identity host | Passkeys, DID creation and log hosting, key encryption, audit log, authorize page, email verification and recovery | 9, 12, 28, 35, 36, 37 |
| M8. Sign-in | Note, `auth_attempts`, sessions, accounts, login methods, seed copy, member read state | 10, 11, 23 |
| M9. Following | Follow flow, Following page, streams, mutes, Ended, Quiet, circles | 13, 14, 15, 17, 18, 19 |
| M10. Modes and plugins | Mode switch, Civic theme, panel surface, plugin manifest and registry, Coming up, placeholders | 7, 8 |
| M11. Finish | Export API, `@live` tests, performance report, production deploy to river.mosaic.social and id.mosaic.social | 29, 32, 34 |
| M12 (stretch) | Real media: a PeerTube channel through the fediverse adapter; an RSS/podcast adapter | none set |

## Appendix A. Architecture

One repo, one codebase, laid out like the greenfield template (`Mosaic-Foundation/greenfield-starter`):

- `src/river/`: River routes, adapters, feed, following, modes and plugins.
- `src/identity/`: identity host routes, passkeys, keys, DID log, email; `src/identity/client/` holds the one small browser script for passkeys, bundled with esbuild.
- `src/shared/`: item model, fetch guard, sanitizer, shared types.
- `src/db/`: the `pg` pool and the `forInstance()`, `forAccount()` and `forIdentity()` helpers. The only place `pg` is imported.
- `ui/`: the River's React app. The identity host's few pages (authorize, sign up, recover, verify email, change email) are server-rendered HTML.
- `src/app.ts` builds the Express app from `APP=river|identity`, mounting only that side's routes.

**Two Vercel projects from the same repo.** `river` uses the repo root and the template's `vercel.json`. `river-identity` uses Root Directory `identity/`, which holds its own `vercel.json` (every path rewritten to the function, install and build run from the repo root) and `api/index.ts` (imports `../../src/app.js` with `APP=identity`). Vercel's "Include source files outside of the Root Directory in the Build Step" is on by default for projects created after August 2020 ([Vercel monorepo FAQ](https://vercel.com/docs/monorepos/monorepo-faq)). Each project holds only its own secrets; the identity master key lives only in `river-identity`. M0 must prove a preview of each answers `/health`. If the identity project can't build this way, the fallback is one Vercel project serving both hostnames, which puts the master key in the River's deployment too; that is a `needs-adam` decision.

**Locally:** River API on :3000 (`npm run dev`), identity host on :3001 (`npm run dev:identity`), River UI on :5173. `RP_ID=localhost` locally; Chromium treats localhost as a secure context, so `Secure` cookies and WebAuthn work.

**Flow:** browser to River (UI + API). River to Civic Hubs and fediverse servers, server-side through the fetch guard. River and identity host linked only by the sign-in redirect and signed note. Both apps to one Supabase Postgres through the shared pooler, each as its own role. Conventions from the Civic Hub: ADR-001 stack, ADR-004-style hostname tenancy with RLS, ADR-005 `pg` use, ADR-006/007 free-tier operations.

## Appendix B. Security requirements

- **Fetch guard** (own ADR): port `civic-hub/src/utils/ssrfGuard.ts` (the Foundation is moving the Civic Hub to AGPL and has approved reuse here; a reference copy arrives in docs/reuse/). HTTPS only. Resolve DNS, check every address (loopback, private, link-local, CGNAT, multicast, metadata, and IPv6 forms that embed IPv4: mapped, NAT64, 6to4, Teredo), and connect to the checked address through a custom `lookup` so the socket cannot be re-pointed. Follow redirects manually, at most 3, re-resolving and re-checking each hop and refusing `http:`. Response cap 2 MB; timeout 6 s; `User-Agent: MosaicRiver/0.1 (+https://river.mosaic.social)`; at most 2 concurrent requests per host; honor `Retry-After`. The module takes an injected resolver and undici `Dispatcher` for tests; no production path accepts a private-address override.
- **Sanitizer**: `sanitize-html`, tags p, br, a, span, ul, ol, li, blockquote, code, pre, em, strong; attributes `href` (https only; `rel` forced to `nofollow noopener noreferrer`) and `class` (values `invisible`, `ellipsis` only).
- **Keys**: master key only in the identity app's secrets; per-person envelope encryption; never logged; every use audited. Adam keeps an offline copy of the master key (for example in his password manager). If it is lost anyway, the offline recovery update key restores every DID (4.6). The private recovery key never touches a server.
- **Sessions**: `HttpOnly`, `Secure`, `SameSite=Lax`; state-changing River routes also check `Origin` against RIVER\_PUBLIC\_ORIGIN. The River and identity cookies have different names, since cookies ignore ports on localhost.
- **CSP** on both apps: no inline scripts; `img-src 'self' https:`; `connect-src 'self'`.

## Appendix C. ADRs (texts in the build hand-off, added by the docs PR)

1. Outbound fetching and the fetch guard (extends the hub's outbound-call rule, CLAUDE.md constraint 5).
2. Identity host, custodial did:webvh, and the v1 signed-note sign-in, with the plan to move to an atproto-style OAuth profile.
3. The item model and the hub activity allowlist.
4. Instances and hostname resolution (ADR-004 style), database roles and RLS via `SET LOCAL`, with person-owned data.
5. Image loading in v1 (straight from source) and the thumbnail service planned for later.

6) One codebase, two deployments (the APP switch; Vercel projects river and river-identity).

## Appendix D. Configuration and secrets

- **River**: `DATABASE_URL` (`postgresql://river_app.[project-ref]:[password]@[pooler host]:6543/postgres`), `SESSION_SECRET`, `RIVER_PUBLIC_ORIGIN` (the River's own origin, used for `aud`, `redirect_uri` and Origin checks), `IDENTITY_ORIGIN=https://id.mosaic.social`, `TRUSTED_DID_HOSTS=id.mosaic.social`, `INSTANCE_HOST_ALIASES` (localhost and the River's vercel.app hosts until river.mosaic.social is live). Before DNS, IDENTITY\_ORIGIN and TRUSTED\_DID\_HOSTS name the identity project's production vercel.app host; accounts made there are test accounts, deleted when the identity host moves to id.mosaic.social, because passkeys are bound to their host name and the DID contains it. Sign-in works on production deployments and locally; PR previews can browse but not sign in, since the identity host accepts only exact registered redirect URIs.
- **Identity**: `DATABASE_URL` (pooler, role `identity_app`), `IDENTITY_MASTER_KEY` (32 random bytes, base64), `IDENTITY_RECOVERY_PUBLIC_KEY` (public half only, multikey format), `RP_ID=id.mosaic.social`, `IDENTITY_PUBLIC_ORIGIN`, `RIVER_CLIENT_ORIGINS` (exact River origins allowed to sign in), `EMAIL_TRANSPORT` (`log` writes one redacted line per email, with the address masked and no link or token; `capture` keeps emails for tests; `resend` sends them), `SESSION_SECRET`. Both apps also read `APP` (`river` or `identity`).
- **Seeds**: instance row for river.mosaic.social; seed follows `https://demosville.civic.social`, `https://floyd.civic.social`, `https://longmont.civic.social`, `@wearenew_public@mastodon.social`, `@w3c@w3c.social`, `@eff@mastodon.social`, `@internetarchive@mastodon.archive.org`, `@wikipedia@wikis.world`, `@swf@socialwebfoundation.org`; sample spaces from 4.4; default circles Civic (civic role, the three hubs), News and ideas (the six fediverse accounts, the sample publication and podcast), Family, Soccer, Neighborhood (matching samples).
- **Supabase**: one free project in the Mosaic Dev org; pause or remove another project there first (two active projects per free org). Free projects pause after about a week without activity; resume from the dashboard before a demo.

* **Email**: `RESEND_API_KEY` and `EMAIL_FROM=Mosaic ID <id@mosaic.social>` in the identity app only. Adam adds Resend's SPF and DKIM DNS records for mosaic.social before M7 is tested against real mail; tests use a capture mailbox.

## Appendix E. Open items for Adam

- [x] Hosting: Vercel Hobby and free Supabase are fine. This is non-commercial early development; move to paid plans when the River is shared widely. (Adam, 2026-10-20)
- [x] Lost passkey must not mean a lost account: email recovery added (4.6). (Adam, 2026-10-20)
- [ ] DNS for river.mosaic.social and id.mosaic.social, plus Resend's email records for mosaic.social: Adam, when the build reaches M7 and M11.
- [ ] Smaller defaults, kept unless Adam objects: visitors can read and filter but must sign up to follow or make circles; a visitor's read marks stay in their browser; the final result of a followed process is kept after the 90-day cleanup; replies that followed fediverse accounts post to other people are left out of the feed (this is about what shows, not about the reader replying); withdrawn hub processes are hidden; only DIDs hosted at id.mosaic.social can sign in during v1; one DID holds one account per River instance.

## Appendix F. What changed from draft 1

The independent review found 5 blockers and 11 major issues; all are fixed above.

| Area | Draft 1 | Draft 2 |
| --- | --- | --- |
| Database access | Per-schema roles through Supabase keys (the service key bypasses RLS, so this could not work) | `pg` via the pooler with two LOGIN roles, `SET LOCAL` per request, FORCE RLS (3) |
| Single-stream follow | Matched on item URLs, which point at meeting summaries, projects and briefs | Extract the `proc_` id from any hub path, key on `/process/{id}`, validate with `?context=` (4.2) |
| First fetch | No starting date: would page through a hub's whole history | 90 days back, at most 5 pages, saved per page (4.2) |
| Cleanup | "No scheduled jobs", so nothing ran retention | One daily pg\_cron job (4.5) |
| Tests | Fixtures could not exercise the fetch guard | Injected resolver and undici MockAgent (6, B) |
| Fetch guard | Written fresh | Port of the hub's ssrfGuard.ts with DNS pinning (B) |
| Refresh window | `since` = newest item | Newest minus 14 days, because hubs backdate news (4.2) |
| Hub allowlist | By activity type only; missed official responses and closed proposals | By activity, object and process type (4.2) |
| Stream end | Dropped at End, losing the results that follow | Readable 7 days; final result kept (4.2) |
| Locks and timing | Lock race; slow sources lost | Atomic claim, `waitUntil`, 6 s per request (4.5) |
| Fediverse paging | `min_id` (Mastodon only) | Read `first`, stop at the first known item (4.3) |
| Sign-in | Accepted any DID host; challenge storage unspecified | TRUSTED\_DID\_HOSTS, `auth_attempts`, fixed EdDSA, key from the DID document (4.6) |
| Constraints | Missing uniques and indexes | Added on follows, streams, items, read\_state (3.1) |
