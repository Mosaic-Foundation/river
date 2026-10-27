# Civic Hub changes for acting from the River

2026-10-26 · Phase 2 design session · Accepted by Adam on 2026-10-27 (#66)

What the Civic Hub (`Mosaic-Foundation/civic-hub`) would need so that River members can sign in
to a hub with Mosaic ID, act on hub items from the River (`docs/spec/space-actions-1.md`,
ADR-012), and see hub pages from the River. This file is a request to the hub's own project, not
work for this repo: nothing here is built from the River, and nothing was written to the hub's
repo. File and line references are to the hub's `main` as read on 2026-10-26 (shallow clone).
The hub's own ADRs live in the Civic-Social-Mono root, which wasn't read; where this file cites a
hub ADR, it's as the hub's code and HANDOFF.md describe it.

## What the hub has today

- **Sign-in:** an email one-time code or emailed link (`src/routes/authRoutes.ts:30-40`,
  `src/modules/civic.auth/index.ts`). No passwords, no OAuth, no Supabase Auth.
- **Session:** an opaque 256-bit bearer token (only its SHA-256 stored; 7 or 90 days), sent as
  `Authorization: Bearer` and kept by the UI in `localStorage` (`civic_auth_token`,
  `ui/src/services/tokenStore.ts:10-30`). Valid only on the hub that minted it. Not a cookie.
- **Accounts:** one `users` row per hub; `users.email` is `NOT NULL`
  (`supabase/migrations/20260416000000_initial_schema.sql:49-56`); `users.identity_did` exists
  but nothing writes it (`20260924030000_users_identity_did.sql`). `sessionUser()`
  (`src/middleware/auth.ts:117-127`) is documented as the one place a new sign-in method plugs in.
- **Eligibility:** participating needs a signed-in user who has self-affirmed residency with a
  real name (`src/authz/eligibility.ts:24-59`, `POST /auth/residency`).
- **Actions:** comment `POST /process/:id/input` (`inputController.ts:52-125`, word filter,
  optional anonymity); support `POST|DELETE /proposals/:id/support`; the generic
  `POST /process/:id/action` with `{type, payload}` (support, unsupport, vote, submit). No RSVP,
  no generic poll (word-cloud prompts and Polis votes are the nearest). No per-action rate limit.
- **Advertising:** the process descriptor (`src/services/processDescriptor.ts:90-157`) lists
  resident `actions` with input schemas and `endpoints.action`; `civic.json` lists process types
  and their actions (`src/controllers/discoveryController.ts:17-76`). Feed activities carry none.
- **Identity:** the space id is `did:web:{host}`; `/.well-known/did.json` has no keys.
- **Moderation:** admins hide and restore comments (`src/routes/adminRoutes.ts:161-163`), a
  review queue for submissions, a word filter and an AI Code of Conduct check. No reports, no
  bans, no moderator role.
- **Headers:** `frame-ancestors 'none'` and `X-Frame-Options: DENY` on pages
  (`src/shared/securityHeaders.ts:24-46`, mirrored in `vercel.json`, with a test that they match).
- **Outbound:** the hub's ssrfGuard (`src/utils/ssrfGuard.ts`) blocks private addresses; no host
  allowlist.

## 1. Sign in with Mosaic ID

**Goal:** a hub member can sign in with their Mosaic ID instead of an email code, and the hub
learns their DID, so actions signed by that DID count as that member.

1. **Register the hub as a Mosaic ID client.** Mosaic ID builds its client list from
   `RIVER_CLIENT_ORIGINS`; each hub origin is added there (renaming the variable to
   `MOSAIC_ID_CLIENT_ORIGINS` would be a Mosaic ID change, `needs-adam` here) with the `signin`
   capability only, so a hub can sign people in but can't ask Mosaic ID for signing grants
   (space-actions-1 5.5). ADR-002 says the
   signed note must become an OAuth profile "before any third-party site relies on it". Adam's
   answer (2026-10-27): hubs the Foundation runs on `civic.social` count as first-party and may
   use the v1 note, each registered for sign-in only; a hub run by anyone else waits for the
   OAuth profile. Mosaic ID refuses to start with a `signin`-only client outside `civic.social`.
2. **The flow is the River's** (spec 4.6): the hub sets a short-lived `HttpOnly`, `Secure`,
   `SameSite=Lax` state cookie (its first cookie outside the console), redirects to
   `https://id.mosaic.social/authorize?client_id=https://{hub}&redirect_uri=https://{hub}/auth/mosaic-id/callback&state&nonce`,
   and verifies the note at the callback with the same checks as the River's
   (`river/src/river/auth/note.ts`): `alg` EdDSA only, `iss == sub`, `kid` under the DID, the DID's
   host in the hub's trusted list (`id.mosaic.social`), `aud` the hub's origin, the nonce, times
   with 60 s leeway, the DID log resolved through the hub's guard and verified, the key from
   `authentication`, and a JWS whose `typ` is `mosaic-action+jwt` refused (notes will carry
   `typ: "mosaic-signin+jwt"`, space-actions-1 5.5). The River's verifier can be ported (both
   AGPL).
3. **Accounts.** Step one links: a signed-in hub user chooses "Use my Mosaic ID to sign in", runs
   the flow, and the hub writes `users.identity_did` (with `identity_did_source = 'self'`) after
   checking no other user on that hub holds the DID. A unique index on `(hub_id, identity_did)`
   comes with it. Afterwards, sign-in with Mosaic ID finds that user. Step two, later: new
   members with only a Mosaic ID, which needs `users.email` nullable (a change to an existing
   column) and a rule for hub roles, which are granted by email today
   (`20261023000000_hub_roles.sql`). Mosaic ID never sends the hub an email address.
4. **After sign-in** the hub mints its usual bearer token: nothing else in the hub changes.
5. **Outbound host:** `id.mosaic.social` (DID logs), through the hub's guard. The hub's own ADR
   process applies (its CLAUDE.md constraint 5).

## 2. The space-actions endpoint

1. **Manifest.** `civic.json` gains the `actions` block (space-actions-1 2.1), with
   `audience: "did:web:{hub}"`, `endpoint: "https://{hub}/actions"`, `did_hosts:
   ["id.mosaic.social"]`, `verbs: ["comment", "support"]` (add `rsvp` and `poll_answer` when the hub
   has events and public polls), and `join` pointing at the page that links a Mosaic ID and
   affirms residency.
2. **Feed.** The activity serializer adds `civic:actions` (2.2) to activities whose object accepts
   them, from the same `residentActionsOf()` the descriptor uses: `comment` on a process's
   `Create` (target: the process IRI, `max_length` from the input controller's limit), `support` on
   a proposal or vote-proposal while it collects support (`closes_at` from its deadline). Nothing
   for ballots: `process.vote` has receipts and secret ballots, which signed actions must never
   carry (2.2). Additive to Civic Activity Spec v0.2; the spec change is proposed in this repo's
   `DECISIONS.md`.
3. **Endpoint.** `POST /actions` mounted after `resolveHub` (so the hub comes from the host, and
   `aud` and `htu` are checked against that hub's own values), running the verifier of
   space-actions-1 section 4, then:
   - the member is the hub user with `identity_did` = `iss` (else `not_member` with `join`);
   - eligibility is `canActor(…, "hub.participate")` as for the hub's own forms
     (`not_eligible` otherwise);
   - `comment` goes through the same code path as `POST /process/:id/input` (word filter, the
     hub's identity mode, `community_inputs`), `support` and `withdraw` through the proposals
     module's support and unsupport;
   - the stored row keeps the JWS (a new column or table: an addition to the hub's schema);
   - the answer and the stored `(iss, ref)` answer table (24 hours) and `jti` table (minutes),
     cleared by the hub's existing scheduled cleanup.
4. **CORS:** none needed. The River posts server to server; browsers never call `/actions`.
5. **The `wire_actor_did` already stamped on events** becomes the member's DID for activities that
   came in as signed actions.

## 3. Moderation of incoming actions

- Signed actions get the hub's existing moderation exactly: the word filter, hide and restore,
  the review queue.
- New, because a client can send from anywhere: rate limits per DID and per `client` with the
  hub's `src/db/rateLimit.ts` (suggested: 10 comments and 60 actions an hour per DID); a block list
  of DIDs (and of clients) in hub settings with an admin screen; holding the first three comments
  from a DID the hub hasn't seen before in the review queue (a hub setting, on by default);
  every refusal logged in `hub_admin_audit_log` without the content.
- Reports and a moderator role, which the hub lacks, become more pressing once comments can
  arrive from outside the hub's pages; they are hub work in their own right and not designed here.
- A hidden comment's activity "still serves on the wire" today (hub HANDOFF.md:376); with
  signed actions that matters more, since a River shows the space's answer link. Worth fixing
  first.

## 4. Showing hub pages in the River

**Today** the River frames an item's page only when its headers allow the River (ADR-008); every
hub page says `frame-ancestors 'none'`, so hub items open in a new tab. To frame public hub pages,
the hub would send, on public pages only:

```
Content-Security-Policy: …; frame-ancestors 'self' https://river.mosaic.social
```

(with `X-Frame-Options` dropped on those pages: browsers ignore it when an enforced CSP has
`frame-ancestors`, but the hub's test that pins the two together needs updating). Signed-in pages,
forms, admin and the console keep `frame-ancestors 'none'`, which also guards them against
clickjacking.

**Signed-in pages in a frame don't work across browsers.** The River and a hub are different
sites (`mosaic.social` and `civic.social`), so a hub page in the River's frame is a third-party
context:

- The hub's session lives in `localStorage`, not a cookie. Browsers partition a third-party
  frame's storage by the top-level site: Firefox does by default (MDN, "State Partitioning",
  read 2026-10-26); Chrome and Safari do too as far as we know (Chrome since about version 115),
  which wasn't re-checked this session. So a framed hub page sees a separate, empty storage and
  is signed out, even when the person is signed in on the hub directly.
- A cookie session wouldn't help by default either. `SameSite=Lax` cookies are never sent to a
  cross-site frame (MDN). With `SameSite=None; Secure`, Safari blocks third-party cookies outright
  and Firefox partitions them (Total Cookie Protection, default since Firefox 103); Chrome still
  sends them by default but not in Incognito or when the person blocks them (MDN; Google's
  2024-2025 posts saying it will keep third-party cookies were seen only as search snippets).
- **Partitioned cookies (CHIPS)** (`Set-Cookie: …; Secure; SameSite=None; Partitioned`): Chrome
  114+, Firefox 141+, Safari 26.2+ (MDN browser-compat-data; Safari shipped it in 18.4 and removed
  it in 18.5). A partitioned cookie is keyed to the top-level site, so the person would have to
  sign in again inside the frame, getting a separate session that exists only under the River. A
  WebKit bug report (306194, seen as a search snippet) says Safari 26.2 drops partitioned cookies
  after a cross-site redirect chain, which is exactly what a sign-in redirect is.
- **Storage Access API** (`document.requestStorageAccess()`): Safari 11.1+, Firefox 65+, Chrome
  119+ (MDN browser-compat-data). It needs a click inside the frame, usually a browser prompt, and
  a first-party visit to the hub within the last 30 days (MDN's Storage Access API guide); Safari
  asks per page, and grants lapse after 30 days of use without interaction (MDN). It can reach the
  hub's real cookies, but the hub's session is in `localStorage`, which the API reaches only
  through the newer storage handle (`requestStorageAccess({ localStorage: true })`; browser
  support not checked this session).
- **Passkeys** in a cross-origin frame need the River's frame to delegate them
  (`allow="publickey-credentials-get"`, W3C WebAuthn); per-browser support for that wasn't
  verified, and the River's frame has an empty `allow` list today (ADR-008).

**Recommendation: signed-in hub pages open as a full page, never in a frame.** Public hub pages
may be framed once the hub allows it (above). Anything that needs the person signed in on the
hub (joining, affirming residency, the hub's own forms) opens in a new tab as a first-party page,
where the hub's session works in every browser. The River doesn't need signed-in frames, because
the actions a member takes from the River go through space actions, server to server, with no
hub session at all. Storage Access stays a possible later enhancement for a framed page's "Sign
in" button (prompt, then reload), not something to rely on.

## 5. Order, and what's `needs-adam` on the hub's side

| Step | Hub change | Depends on |
| --- | --- | --- |
| H1 | `frame-ancestors` for the River on public pages (and the header test) | nothing |
| H2 | Sign in with Mosaic ID, link step (callback, verifier, `identity_did` index, state cookie, outbound to `id.mosaic.social`) | Mosaic ID registering the hub as a client |
| H3 | Space-actions endpoint for `comment`, `support`, `withdraw`; manifest block; `civic:actions` in the feed; stored JWS | H2; ADR-012 accepted; Mosaic ID's `assertionMethod` |
| H4 | Moderation additions: per-DID and per-client limits, DID and client blocks, first-comment hold | H3 (ship together) |
| H5 | DID-only members (`users.email` nullable, roles by DID) | H2, Adam |
| H6 | `rsvp` and `poll_answer` when the hub has events and public polls | hub features that don't exist yet |

Under the hub's own rules, H2 to H5 touch authentication, schema and outbound calls, so each would
need Adam's review there.

## Needs checking

- Chrome's and Safari's partitioning of `localStorage` in third-party frames (versions), and
  support for `requestStorageAccess({ localStorage: true })`.
- Google's current third-party cookie plans (only search snippets were seen), and WebKit bug
  306194's status.
- Passkey (`publickey-credentials-get`) support in cross-origin frames per browser.
- The hub ADRs this file cites only as the hub's code describes them.
