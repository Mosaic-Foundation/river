# ADR-010: Acting for members

- **Date:** 2026-10-26
- **Status:** Proposed
- **Scope:** every request the River makes that changes something outside the River in a member's name: fediverse posting (ADR-011, `docs/spec/fediverse-posting-1.md`) and space actions (ADR-012, `docs/spec/space-actions-1.md`). Covers consent, previews, stored credentials, unlinking, limits, the member's activity list, undo, failures and sessions. Code in `src/river/acting/`.
- **Extends:** ADR-002 (identity host and sign-in), ADR-004 (roles and RLS), the session epoch (`DECISIONS.md`, 2026-10-26, "Session revocation"). Changes ADR-002 as described in ADR-012.

## Context

The River v1 only reads (spec 5: "Posting, replying, liking or boosting from the River" is out of scope). Phase 2 has it act for members in two ways:

- **A. Through an account the member already has** on another network, with a credential that network gave the River (ADR-011: a Mastodon-compatible server's OAuth token).
- **B. As the member's DID**, signed by Mosaic ID, sent to a Mosaic space such as a Civic Hub (ADR-012).

Both put the River in a position to speak for people, so both need one set of rules. The constraints are fixed: the River never holds a member's private key or email address (CLAUDE.md constraint 7); the River and Mosaic ID meet only through the sign-in redirect and the signed note (ADR-002), so B changes ADR-002; Mosaic ID keeps no session and asks for a passkey each time (`DECISIONS.md`, "The identity host keeps no session"); the River's session is a stateless cookie that carries the account's session epoch, and "Sign out everywhere" raises it (#63); every outbound request goes through the fetch guard (ADR-001); the River runs on Vercel functions with no long-running worker and a daily `pg_cron` job that makes no network calls (spec 4.5).

## Decision

### 1. What counts as acting

An **act** is any request the River sends that creates, changes or removes something outside the River in a member's name: a post, reply, boost, favourite, follow or delete on the fediverse; a comment, support, RSVP or poll answer at a space; and the undo of any of these. Following a space in the River, circles and read state are not acts: they stay inside the River.

A **channel** is how an act leaves: a **linked account** (A: the River holds a credential for an account on another network) or a **signing grant** (B: Mosaic ID signs as the member's DID; the River never holds the key).

### 2. Nothing acts without the member's click

- Every act starts from a member's own click (or key press) on a control in the River's page, in the request that click sends. No plugin, refresh, import, daily job, retry loop or other member's action can act. Plugins keep `read:items` only (spec 4.7).
- No bulk acts in v1: one click, one act. ("Import from Bluesky" follows inside the River and stays as it is.)
- Acts are made in the request, synchronously. Nothing is queued to be sent later (§10 says what changes if that ever changes).

### 3. Consent: once per channel, and for each act

**Once, at the place that holds the authority.** Linking a channel happens where the power comes from: the member's fediverse server's own OAuth page (A), or Mosaic ID's grant page with a passkey (B). Before sending the member there, the River says in plain words what it will be able to do, as a list of verbs ("post and reply, boost, favourite, follow and unfollow, delete posts made from the River"), and asks only for the scopes those verbs need. The channel then shows in Settings → Linked accounts with the same list, the date linked and the date last used.

**Each act, in the River.** Two kinds:

- **Text acts** (post, reply, comment, poll answer): a preview (§4) and a Send button. Nothing is sent until Send.
- **Toggle acts** (boost, favourite, follow, support, RSVP, and every undo): one click, because the control itself says what will happen and as whom ("Boost as @ana@example.social", "Support as Ana (Mosaic ID)"), and each can be undone (§8). The first toggle on a channel shows a one-time note that these are public and made as that account.

**Step-up, for each act, at Mosaic ID.** Where a space marks an action `assurance: "passkey"` (ADR-012), each one needs a passkey check at Mosaic ID, which shows the act itself. The River adds no step-up of its own in v1.

Consent never carries over: linking a second fediverse account, or a grant with a wider scope, is a new consent.

### 4. A preview of exactly what will be sent

- The River's server builds the outgoing request from the member's input, stores it as a `previewed` row in `river.member_actions` (§7) with the account's current session epoch, and returns it. The page shows it twice: as the reader will see it (text, content warning, visibility, the post or item it answers, the account or DID it comes from, the server or space it goes to), and under "Show exactly what will be sent" as the request itself (the JSON or form fields, every value escaped as text).
- Send names that row. The server sends exactly the stored request, never a rebuilt one, so what was shown is what goes. A row is good for 15 minutes; an expired one answers "This preview is out of date. Check it again." and is purged by the daily job.
- For a signed action, the preview shows the claims Mosaic ID will sign except the three it adds when signing (`iat`, `exp`, `jti`), and names them.
- Toggle acts skip the stored preview; their row is written and sent in one request.

### 5. Credentials, encrypted at rest

- **No private keys.** Constraint 7 is unchanged: a member's DID key stays at Mosaic ID; ADR-012 has Mosaic ID sign. The River's own credential for Mosaic ID is a client secret, not a key (ADR-012).
- **Tokens never leave the River's server.** Linked-account access tokens, OAuth client secrets from per-server app registration, and Mosaic ID grant tokens are stored only in the River's database, encrypted. They are never sent to the browser, logged, put in an error, exported, or written to a fixture.
- **Envelope encryption, as Mosaic ID does it.** `src/identity/keys/envelope.ts` already does what's needed: a fresh 32-byte data key per value encrypts it with AES-256-GCM, and a master key wraps the data key with AES-256-GCM, both with additional authenticated data so a ciphertext copied to another row fails to open. It moves to `src/shared/crypto/envelope.ts` (Mosaic ID imports it from there; no behaviour change), and the River uses it with its own master key, `RIVER_TOKEN_KEY` (32 random bytes, base64, River project only; never in the identity project or the database). The additional data is `river-token:v1|{instance_id}|{account_id}|{row id}|{purpose}`. Each row stores the master key's version, so the key can be rotated by re-wrapping data keys.
- **Mosaic ID keeps only hashes** of the grant tokens it issues (SHA-256, as for recovery tokens).
- **What a leak costs.** The database alone gives nothing usable. The database plus `RIVER_TOKEN_KEY` gives every linked token: then every link is revoked (`npm run revoke-links`, which calls each server's revoke endpoint and deletes the rows), Mosaic ID revokes every grant for the River's client in one statement, and members are told. The runbook goes in `docs/deploy.md` with the first PR that stores a token.

### 6. Unlinking and revocation

- **The member unlinks** in Settings → Linked accounts. The River asks the other side to revoke the credential (fediverse: `POST /oauth/revoke`; Mosaic ID: `POST /grant/revoke`), then deletes the ciphertext whether or not that answered. The row stays, without the credential, for the activity list. If the revoke didn't answer: "We've forgotten the key to @ana@example.social. To be sure, also remove Mosaic River from that server's authorized apps."
- **Revoked elsewhere.** A credential refused by the other side (a 401 the network uses for a revoked or invalid token) marks the link `revoked` and deletes its ciphertext at once; the member sees "Your link to @ana@example.social stopped working. Link it again." The act that hit it fails with that message.
- **Idle links lapse.** A credential unused for 180 days is deleted by the daily job (SQL only, so it can't call the server; the authorization left there is inert because nobody holds the token). The member links again when needed.
- **Mosaic ID's side.** The member can see and revoke grants on Mosaic ID's account page. A Mosaic ID recovery revokes every grant of that person, since a recovery may mean someone else had a passkey; the River then sees `grant_revoked` on the next signed action and asks the member to grant again.
- **Sign-in DID changes.** A grant is for one DID. If the River account's DID login method ever changes, its grants are deleted.

### 7. The activity list the member can see

- Every act is a row in `river.member_actions` (RLS by account, `forAccount()` only): when, channel and target (the linked account or space), verb, the item it answers (title, link), the request sent (§4), status (`previewed`, `sent`, `held` (a space holds it for review), `failed`, `unknown`, `undone`), the remote id and link it produced, the error code, the session epoch, and the row it undoes.
- "Your activity" (profile menu, and the phone's You tab) lists them newest first, with the result, a link to it, and Undo where §8 allows. A member who suspects a stolen session reads it here.
- **Retention.** Rows are kept a year, then deleted by the daily job. When the member deletes a post or withdraws an action, the stored text of the original is erased at once and the row keeps only verb, target, time and status: deleting something should remove it from the River too.
- Mosaic ID keeps its own record of every signature (`audit_log` action `action_signed`: client, space host, verb, `jti`; never the content), shown on its account page under "Signed for apps".
- The export (spec 3.3) does not include the activity list in its version 1; adding it is a later format change.

### 8. Undo, where the network allows it

- Each verb has its undo, listed in the specs: delete for a post or reply, unboost, unfavourite, unfollow, withdraw for a comment or support where the space allows it, change or withdraw for an RSVP. A poll answer is undone only if the space says it can be.
- An undo is an act of its own: a new row pointing at the original, sent under the same rules, with no preview (the original is on screen).
- The River says what an undo can't promise: a fediverse delete asks other servers to delete their copies, and some won't; a space may already have counted a support.

### 9. Limits and failures

- **Per-account limits, in the database.** Before any outbound request the River counts the account's rows in rolling windows, holding a row lock on the account so two requests can't both pass. The numbers are in each spec (for example, text acts 30 an hour and 100 a day). Over a limit: 429 and "You've sent a lot from the River in the last hour. Try again after 14:20." Mosaic ID applies its own per-person signing limits, so even a compromised River can't exceed them, and spaces apply theirs.
- **No silent retries.** The River never retries an act on its own.
- **Text acts are never optimistic.** The composer keeps the text until the other side confirms; on failure the text stays and the error shows beside Send. Toggle acts change on click and change back, with the error, if the request fails (as the circles menu does, `ui-revisions-7.md` item 2).
- **Unknown is not failed.** A request that times out may have arrived. Its row is `unknown`, and the member sees "We couldn't tell whether example.social got it" with "Check on example.social" and "Try again". Try again is safe: fediverse posts carry an `Idempotency-Key` where the server supports it, and a space returns the stored answer for a repeated signed action (ADR-012).
- **Messages name the other side.** Every failure maps to one message from a fixed list in the spec, naming the server or space. A message from the other side is shown as plain text, at most 300 characters, after its host's name ("example.social says: …").

### 10. Sessions: a stolen session can't act after "Sign out everywhere"

- Every acting route needs a signed-in member at the account's current session epoch (`readSession()` already refuses any other cookie), an `Origin` check, and, for Send, a previewed row whose stored epoch is still the account's epoch.
- Credentials never reach the browser (§5), so a stolen session holds nothing but its cookie, and "Sign out everywhere" ends that cookie on its next request. Nothing it previewed can be sent afterwards, and nothing is queued for later (§2), so nothing it started can complete after the epoch moves.
- If a later ADR queues acts (for example, delivery from a River ActivityPub actor, ADR-011's alternative), each queued act carries the epoch it was made under and is dropped, not sent, if the account's epoch has moved by the time it runs.
- "Sign out everywhere" says: "Check Your activity for anything you didn't send." Unlinking stays separate: the credentials were never in the stolen session.
- A Mosaic ID recovery doesn't sign out River sessions yet (later options, `DECISIONS.md`); it does revoke grants (§6), so a recovered account's signed actions stop until the member grants again.

## Alternatives considered

- **Consent at the authority for every act** (an OAuth or passkey round trip each time): strongest, but a favourite would take two page loads. Kept as step-up for actions a space marks.
- **One standing consent with no per-act preview:** fastest, but members couldn't see what goes out under their name before it does.
- **A key held by the River for each member, delegated by their DID** (a UCAN or ZCAP-style capability): no call to Mosaic ID per act, but the River would hold private keys (constraint 7), and every space would have to verify delegation chains and their revocation.
- **Tokens in the browser** (a client-side OAuth app): the River's server never sees them, but `connect-src 'self'` would have to open to every server, any script injection would take the tokens, and the River couldn't enforce limits or keep the activity list.
- **Encrypting tokens with database features** (pgcrypto, Supabase Vault): the key would sit with or beside the data it protects.
- **Rebuilding the request at Send and comparing a hash with the preview:** works, but a stored row is simpler to reason about and is the activity list's row anyway.
- **A client-side send delay ("Undo" for 5 s before sending):** the preview and Send already are the consent; real undo (§8) covers mistakes after.

## Consequences

- New tables `river.member_actions`, `river.linked_accounts` and `river.oauth_clients` (all new, RLS in the same migration), a new River secret `RIVER_TOKEN_KEY`, and the envelope module moving to `src/shared/crypto/` (touches `src/identity/keys/`, so `needs-adam`).
- New screens: Settings → Linked accounts, and Your activity.
- Each act is a database write plus one or two outbound requests inside the click's request, so a send takes as long as the other side does, up to the guard's 6 s.
- The River becomes a holder of credentials that can speak for people. The limits, the audit list, and the revocation runbook are what keep that bounded.
- Revisit when acts need to be queued (a River actor, scheduled posts), when the export grows an activity list, and when River sessions can be signed out after a Mosaic ID recovery.
