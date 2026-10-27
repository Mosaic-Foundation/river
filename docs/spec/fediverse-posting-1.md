# Fediverse posting 1: acting through a member's linked account

2026-10-26 · Phase 2 design session (Proposed; for Adam)

A member links their Mastodon or GoToSocial account to the River, then replies to, boosts,
favourites and follows what they read, and writes posts, from the River, as that account. The
decision and the approaches compared are ADR-011 (`decisions/011-fediverse-posting.md`); the
rules shared with space actions (consent, previews, credentials, the activity list, undo,
limits, failures, sessions) are ADR-010 (`decisions/010-acting-for-members.md`). Where this file
differs from `river-v1.md` (section 5: no posting), this file wins. Reading the fediverse
(spec 4.3) is unchanged.

## 1. Linking an account

1. **Where.** Settings → Linked accounts → "Link a fediverse account". One box takes a handle
   (`@ana@example.social`) or a profile URL. A member may link up to 3 accounts.
2. **Finding the server.** The River resolves the handle with WebFinger (spec 4.3) and takes the
   host of the actor URL as the server. It reads NodeInfo. `software.name` must be `mastodon` at
   4.3 or later or `gotosocial` at 0.19 or later; otherwise: "The River can't post through
   {software} yet" (or "… through this version of Mastodon yet"). It reads `/api/v2/instance`
   for the limits (item 3). Both always use PKCE with S256. Per software:
   - **Mastodon 4.3+:** `/.well-known/oauth-authorization-server` must list `S256` (else the
     link is refused as an unsupported version); the identity scope is `profile`.
   - **GoToSocial 0.19+:** PKCE S256 without a discovery document; the identity scope is
     `read:accounts`.
3. **What the member is told first:** "Mosaic River will be able to post and reply as
   @ana@example.social, boost, favourite, follow and unfollow, and delete posts you make from
   the River. It can't read your messages or change your profile. You'll see each post before
   it's sent. You can unlink at any time." Then "Continue to example.social".
4. **App registration**, once per server and River instance (`river.oauth_clients`):
   `POST /api/v1/apps` with `client_name=Mosaic River`,
   `redirect_uris[]=https://river.mosaic.social/api/auth/fediverse/callback`,
   `scopes={identity scope} write:statuses write:favourites write:follows read:follows read:search`,
   `website=https://river.mosaic.social`.
5. **Authorization.** The River stores an attempt (state, PKCE verifier, encrypted) and sets a
   10-minute state cookie (`HttpOnly`, `Secure`, `SameSite=Lax`), then sends the browser to
   `https://{server}/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&scope=…&state=…&code_challenge=…&code_challenge_method=S256`.
6. **Callback** (`GET /api/auth/fediverse/callback`; `Referrer-Policy: no-referrer` and an
   immediate redirect, so the code doesn't linger): the state cookie must match and the attempt is
   consumed. `POST /oauth/token` (`grant_type=authorization_code`, `code`, `redirect_uri`,
   `client_id`, `client_secret`, `code_verifier`), then
   `GET /api/v1/accounts/verify_credentials`. The account's `url` or `acct` must match what the
   member typed (else "That's a different account from the one you named" and the token is
   revoked). The River stores the token encrypted (ADR-010 §5) with the account's id, `acct`,
   actor URI, display name, avatar URL, granted scopes, and default visibility and language from
   `source` when present.
7. **Unlink** (ADR-010 §6): `POST /oauth/revoke` (`client_id`, `client_secret`, `token`), then
   the token is deleted whatever the answer.

## 2. Where the actions show

1. **On fediverse cards** (live items from fediverse spaces, including boost cards, which act on
   the boosted post): Reply, Boost, Favourite in the card's footer beside Open ↗, for members
   with a linked account. Visitors and members without one see none. Samples, hub, feed and
   Bluesky items show none.
2. **Follow on the server:** on a fediverse space's Following row and its card's source menu,
   "Follow as @ana@example.social" (Unfollow once followed, from
   `GET /api/v1/accounts/relationships`). This is separate from following the space in the River;
   neither does the other.
3. **New post:** a "Post" button in the top bar beside Follow (in the phone's You tab) when a
   linked account exists.
4. **Delete:** in Your activity, on posts and replies made from the River.
5. **Which account:** with several linked, the composer and the toggles' menus name the account
   and offer the others; the default is the one used last.

## 3. Writing a post or reply

1. **Character limit:** `configuration.statuses.max_characters` from `/api/v2/instance` (Mastodon
   default 500; GoToSocial default 5,000). On Mastodon a link counts as
   `characters_reserved_per_url` (23) and a mention `@user@domain` as `@user`, and the content
   warning counts toward the limit; the counter follows these rules for Mastodon and counts plain
   characters elsewhere. The server decides: a 422 shows its message. The counter turns red and
   Preview is disabled over the limit.
2. **Content warning:** "Add a content warning" opens a field sent as `spoiler_text`. A reply to
   a post with a warning starts with the same warning, which the member may change.
3. **Visibility:** Public, Quiet public (`unlisted`), Followers only (`private`); the default is
   the account's own (`source.privacy`), else Public. A reply to a Quiet public post defaults to
   Quiet public. Direct messages (`direct`) and GoToSocial's `mutuals_only` aren't offered: the
   River has nowhere to show the conversation that follows.
4. **Language:** the account's `source.language` when present, else none.
5. **Replying:** the composer quotes the post being answered (author, start of the text). On
   Preview the River resolves it on the member's server
   (`GET /api/v2/search?q={post URI}&resolve=true&type=statuses&limit=1`; for a boost card, the
   boosted post); if that finds nothing: "example.social couldn't find this post." The reply
   mentions the author (`@user@domain` at the start) unless the member removes it.
6. **Preview** (ADR-010 §4) shows the post as followers will see it (warning, text, visibility,
   the post it answers, "as @ana@example.social") and, under "Show exactly what will be sent",
   the request: `POST https://example.social/api/v1/statuses` with its fields.
7. **Send** posts it with `Idempotency-Key: {the activity row's id}`. Success: "Posted on
   example.social" with View ↗ (the status `url`). The composer clears only then.

## 4. Toggles

| Act | Request | Undo |
| --- | --- | --- |
| Boost | `POST /api/v1/statuses/:id/reblog` (`visibility=public`) | `POST …/unreblog` |
| Favourite | `POST /api/v1/statuses/:id/favourite` | `POST …/unfavourite` |
| Follow | `POST /api/v1/accounts/:id/follow` | `POST /api/v1/accounts/:id/unfollow` |
| Post or reply | `POST /api/v1/statuses` | `DELETE /api/v1/statuses/:id` |

The local `:id` comes from `search` with `resolve=true` (`type=statuses` or `type=accounts`). The
search answer's `reblogged` and `favourited` set the toggles' starting state. A follow of a
locked account reads "Requested". The first toggle on an account shows once: "Boosts,
favourites and follows from the River are made publicly as @ana@example.social."

Delete says: "Deleted on example.social. Other servers are asked to delete their copies; some may
keep them." Mastodon returns the deleted text; the River doesn't keep it (ADR-010 §7).

## 5. Limits

- **River, per account:** ADR-010 §9's table, shared by every linked account and space actions
  (text 30 an hour and 100 a day; toggles 120 an hour and 600 a day; follows 50 a day; deletes 30
  in 30 minutes).
- **Mastodon's own** (source, 2026-10-26): 300 requests per 5 minutes per token, 300 posts per 3
  hours per account, 30 deletes or unboosts per 30 minutes. A 429 sets the guard's wait for that
  server and shows "example.social asks you to wait until {time}".

## 6. Media: out of v1

Posts are text only. Why: an upload from the browser would pass through a Vercel function, whose
request bodies are limited to a few megabytes; video and audio are processed asynchronously
(`POST /api/v2/media` answers 202 and the River would poll until `url` is set), which doesn't fit
a click's request; good alt text needs its own interface; and the River would carry people's
files to other servers, with the responsibility that brings. A later step: images only, within
the request limit, with required alt text and `write:media`.

## 7. When it goes wrong

| What happens | Row | The member sees |
| --- | --- | --- |
| 401 (revoked or invalid token) | `failed` | "Your link to @ana@example.social stopped working. Link it again." The link is marked revoked and the token deleted. |
| 403 (missing scope) | `failed` | "example.social didn't allow this. Link the account again to allow it." |
| 404 on resolve | `failed` | "example.social couldn't find this post." |
| 422 | `failed` | "example.social says: {message}" (plain text, 300 characters) |
| 429 | `failed` | "example.social asks you to wait until {time}." |
| timeout, 502, 503 or 504 on a send | `unknown` | "We couldn't tell whether example.social got it." Check on example.social ↗, and on Mastodon, for an hour, Try again (same `Idempotency-Key`, which Mastodon keeps an hour). GoToSocial gets Check on only, until its `Idempotency-Key` support is checked. |
| failure on the search that resolves a post | `failed` | Nothing was sent; the matching message above. |
| other 5xx, connection refused, DNS failure | `failed` | "We couldn't reach example.social. Nothing was sent." |
| server's software changed to an unsupported one | `failed` | "The River can't post through {software} yet." |

A failed toggle goes back to its state; a failed post keeps its text in the composer.

## 8. Data

New tables (ADR-010), RLS in the same migration:

- `river.oauth_clients` (instance, server host, `client_id`, encrypted `client_secret`,
  `redirect_uri`, scopes, software and version, registered at). UNIQUE (instance, host).
  `forInstance()`.
- `river.linked_accounts` (instance, account, kind `fediverse`, server host, actor URI, `acct`,
  remote account id, display name, avatar URL, software, scopes, encrypted token with its key
  version, default visibility and language, status `active`, `revoked` or `unlinked`, created,
  last used, revoked). UNIQUE (account, actor URI). `forAccount()`.
- `river.acting_attempts` (state, instance, account, purpose `fediverse_link`, `grant` or
  `step_up`, server host, encrypted PKCE verifier, created, used). Purged by the daily job after
  a day.
- `river.member_actions` (ADR-010 §7).

New variable: `RIVER_TOKEN_KEY` (River only).

## 9. Tests and fixtures

- **Stand-in server** (`tests/support/standInMastodon/`): a Mastodon-shaped server built from the
  documented requests and answers (the `mastodon/documentation` repo, read 2026-10-26), with a
  GoToSocial mode (NodeInfo `gotosocial`, 5,000 characters, no discovery document). It runs
  behind the guard's injected dispatcher at `https://mastodon.stand-in.example` and
  `https://gts.stand-in.example`, enabled by the test-only `TEST_STAND_IN_FEDIVERSE=1` (refused on
  Vercel). It records what it receives, checks the token and scopes, and has switches for revoked
  tokens, missing scopes, 422, 429 with `Retry-After`, slow answers and a redirect.
- **Recorded fixtures** of the GET requests (NodeInfo, instance, discovery, search, relationships)
  from a real test account, when Adam provides one: `npm run record-fixtures -- --fediverse-post
  {handle}`, reading the token from a file outside the repo. The recorder never writes a token,
  secret or `Authorization` header into a fixture.

## 10. Acceptance checks

1. Linking `@ana@mastodon.stand-in.example` (Mastodon 4.3): NodeInfo, discovery and instance are read; the
   explainer lists the verbs; the app is registered once (a second member on the same server
   reuses it); the authorize URL carries `state`, S256 `code_challenge` and exactly the scopes in
   1.4; after the callback the row holds an encrypted token and the database bytes don't contain
   it.
2. A callback with a missing or different state cookie, a used attempt, or an account other than
   the one typed creates no link (the last revokes the token at the stand-in).
3. A GoToSocial account links with PKCE, `read:accounts` and its instance's 5,000-character
   limit; Mastodon 4.2, a Mastodon without a discovery document, and a server whose NodeInfo says
   `akkoma` or anything else are each refused with the message, and nothing is registered.
4. A fediverse card shows Reply, Boost and Favourite to a linked member, none to a visitor or an
   unlinked member, and none on sample, hub, feed or Bluesky cards; a boost card's actions target
   the boosted post (the stand-in receives its URI in `search`).
5. Reply: the preview shows the warning carried from the original, the visibility, "as
   @ana@…", the answered post and the exact request; Send posts exactly that body with an
   `Idempotency-Key`; the reply appears in Your activity with View ↗.
6. The counter counts a 40-character URL as 23 on Mastodon, counts the content warning, and
   disables Preview over 500; on GoToSocial the limit is 5,000.
7. Visibility offers Public, Quiet public and Followers only (never Direct) and defaults to the
   account's `source.privacy`.
8. Boost and Favourite change at once and are recorded; when the stand-in refuses, they change
   back and the message shows; Undo sends unreblog or unfavourite.
9. Follow as the linked account follows at the stand-in and shows Unfollow; a locked account
   shows Requested; following on the server doesn't follow the space in the River, or the other way
   round.
10. Delete from Your activity sends `DELETE` for that status, shows the copies note, and erases
    the stored text.
11. A revoked token (stand-in 401) marks the link revoked, deletes the token, and shows "Link it
    again"; a 403 shows the scope message; a 422 shows the server's message as text (a `<b>` in
    it shows as characters).
12. A send that times out (fake timers) is `unknown` with Try again; Try again sends the same
    `Idempotency-Key`, and the stand-in records one post; after an hour only Check on is offered;
    on the GoToSocial stand-in only Check on is offered.
13. A 3xx from the stand-in on any token-carrying request is a failure, and nothing reaches the
    redirect's target (counted).
14. Unlink calls `/oauth/revoke` and deletes the token; with the stand-in down, the token is still
    deleted and the "also remove it there" note shows.
15. River limits: the 31st post in an hour answers 429 and reaches no server; two racing posts
    for the last allowance send one.
16. "Sign out everywhere" in one browser, then Send from a second browser's previewed reply: 401
    and nothing reaches the stand-in.
17. `river_app` as member A can't read member B's linked accounts or actions; no API response,
    log line or error contains a token or client secret; the River's page never receives one.
18. axe finds no serious issue on Linked accounts, the composer, the preview and Your activity;
    linking, replying, boosting and unlinking work from the keyboard alone.
