# Space actions 1: comment, support, RSVP and poll answers, signed as the member's DID

2026-10-26 · Phase 2 design session · Accepted by Adam on 2026-10-27 (#66; answers in `DECISIONS.md`)

The River shows the actions a Mosaic space accepts on its items, and sends each one to the space
signed as the member's DID by Mosaic ID. This file is the protocol, **Mosaic Space Actions 0.1**,
which any Mosaic space can implement, and the River's and Mosaic ID's parts of it. The decision
is ADR-012 (`decisions/012-space-actions.md`); the rules shared with fediverse posting (consent,
previews, credentials, the activity list, undo, sessions) are ADR-010
(`decisions/010-acting-for-members.md`) and are not repeated here. The Civic Hub's side is in
`docs/civic-hub-changes.md`. Where this file differs from `river-v1.md` (section 5 keeps the
River read-only and the hub unchanged), this file wins.

Words: MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119, for the protocol parts (1 to 6).

## 1. Parties

- **Member:** a person signed in to the River with a Mosaic ID (a `did:webvh` at Mosaic ID).
- **Client:** the River (`https://river.mosaic.social`), a client registered at Mosaic ID.
- **Signer:** Mosaic ID (`https://id.mosaic.social`). It holds the member's custodial key and
  signs only for a client the member has granted.
- **Space:** a Civic Hub or other Mosaic space that publishes a manifest and an AS2 feed.

```
member ──click──▶ River ──(1) sign this──▶ Mosaic ID
                    │ ◀──── JWS ──────────────┘
                    └──(2) POST JWS──▶ space ──(3) resolve DID log──▶ id.mosaic.social
                    ◀──── result ──────┘
```

## 2. How a space advertises actions

### 2.1 In the manifest

A space that accepts actions adds `actions` to its manifest (for a Civic.Social space,
`https://{host}/.well-known/civic.json`):

```json
{
  "space": { "id": "did:web:demosville.civic.social", "type": "civic.hub" },
  "actions": {
    "protocol": "mosaic-space-actions/0.1",
    "endpoint": "https://demosville.civic.social/actions",
    "audience": "did:web:demosville.civic.social",
    "did_hosts": ["id.mosaic.social"],
    "verbs": ["comment", "support", "rsvp", "poll_answer"],
    "join": "https://demosville.civic.social/join?with=mosaic-id",
    "terms": "https://demosville.civic.social/terms"
  }
}
```

- `protocol` MUST be `mosaic-space-actions/0.1`. A client MUST ignore an `actions` block with
  any other value.
- `endpoint` MUST be `https:` on the same host as the manifest. A client MUST ignore the block
  otherwise.
- `audience` MUST equal `space.id` when the space has one, else the space's origin.
- `did_hosts` lists the hosts whose DIDs the space accepts. In 0.1 only `did:webvh` DIDs are
  defined.
- `verbs` lists the verbs the space implements (section 3). A client MUST ignore verbs it doesn't
  know.
- `join` (optional) is a page where a person becomes a member of the space, opened as a full page.
- `terms` (optional) is the page whose rules apply to what members send.

### 2.2 In the feed

An activity in the space's feed MAY carry `civic:actions`: the actions its object accepts now.

```json
{
  "id": "https://demosville.civic.social/activities/evt_81",
  "type": "Create",
  "object": { "id": "https://demosville.civic.social/proposals/prop_9", "type": "civic:Proposal" },
  "civic:actions": [
    { "verb": "comment", "target": "https://demosville.civic.social/process/proc_4", "max_length": 2000 },
    { "verb": "support", "target": "https://demosville.civic.social/proposals/prop_9",
      "closes_at": "2026-11-30T23:59:59Z" }
  ]
}
```

Each entry:

| Field | Verbs | Meaning |
| --- | --- | --- |
| `verb` | all | One of the manifest's `verbs`. |
| `target` | all | The IRI the action is about. MUST be on the space's host. |
| `closes_at` | all, optional | After this time the space refuses the action (`closed`). |
| `max_length` | `comment` | Characters allowed (at most 5,000; default 2,000). |
| `options` | `rsvp` | A subset of `["yes", "no", "maybe"]`. |
| `choices` | `poll_answer` | `[{ "id": "a", "name": "Plain text label" }, …]`, 2 to 20 entries. |
| `multiple` | `poll_answer` | `true` if several choices may be picked (default `false`). |
| `changeable` | `rsvp`, `poll_answer` | `true` if a later answer replaces an earlier one (default `true` for RSVP, `false` for polls). |
| `withdrawable` | all | `false` if a sent action can't be withdrawn (default `true` except polls). |
| `assurance` | all, optional | `"passkey"`: every such action needs a fresh passkey check at the signer. |

The list is public and the same for every reader: it MUST NOT carry anything about a person
(whether they already supported, for example). A space that wants the River to stop offering an
action removes it from later activities or sets `closes_at`; the space is always the authority at
send time.

**Secret ballots.** A signed action names its signer. A space MUST NOT advertise `poll_answer`
(or any verb) for a vote whose individual answers are meant to be secret. `poll_answer` is for
polls whose answers the space may attribute.

### 2.3 Mapping to AS2

A space that publishes what members did SHOULD use these activities, with the member's DID as
`actor`:

| Verb | AS2 |
| --- | --- |
| `comment` | `Create` a `Note`, `inReplyTo` the target |
| `support` | `Like` the target |
| `rsvp` | `Accept` (yes), `TentativeAccept` (maybe) or `Reject` (no) the target |
| `poll_answer` | `Create` a `Note` with `name` set to the choice, `inReplyTo` the target `Question` |
| `withdraw` | `Undo` the earlier activity (or `Delete` the comment's `Note`) |

## 3. The request

### 3.1 HTTP

```
POST /actions HTTP/1.1
Host: demosville.civic.social
Content-Type: application/jwt
Accept: application/json

eyJhbGciOiJFZERTQSIsInR5cCI6Im1vc2FpYy1hY3Rpb24rand0Iiwia2lkIjoi…
```

The body is one compact JWS, at most 16 KB. No cookies and no `Authorization` header are sent.

### 3.2 Header

```json
{ "alg": "EdDSA", "typ": "mosaic-action+jwt", "kid": "did:webvh:Qm…:id.mosaic.social:u:k7q2m9h3#key-1" }
```

### 3.3 Claims

```json
{
  "iss": "did:webvh:Qm…:id.mosaic.social:u:k7q2m9h3",
  "sub": "did:webvh:Qm…:id.mosaic.social:u:k7q2m9h3",
  "aud": "did:web:demosville.civic.social",
  "htm": "POST",
  "htu": "https://demosville.civic.social/actions",
  "iat": 1793050000,
  "exp": 1793050120,
  "jti": "3mJ2rTq0V5yWcQ8xZk1bNw",
  "client": "https://river.mosaic.social",
  "assurance": "grant",
  "act": {
    "verb": "comment",
    "target": "https://demosville.civic.social/process/proc_4",
    "content": "Could the skate park stay open until 9 in summer?",
    "lang": "en",
    "ref": "8f1c2b7e-0d4a-4c1e-9a55-1f3b2c6d7e80"
  }
}
```

| Claim | Rule |
| --- | --- |
| `iss`, `sub` | The member's DID; equal. |
| `aud` | The manifest's `actions.audience`. |
| `htm`, `htu` | `POST` and the manifest's `actions.endpoint`, exactly. |
| `iat`, `exp` | Seconds. `exp - iat` at most 300 (Mosaic ID uses 120). |
| `jti` | 16 random bytes, base64url. Unique per JWS. |
| `client` | The origin of the client Mosaic ID authenticated. Set by the signer, never by the client. |
| `assurance` | `grant` (signed under a standing grant) or `passkey` (a passkey check for this action). |
| `act` | The action (3.4). |

### 3.4 `act`

| Verb | Fields |
| --- | --- |
| `comment` | `target`, `content` (plain text, 1 to 5,000 characters, no HTML), optional `lang` (BCP 47) |
| `support` | `target` |
| `rsvp` | `target`, `answer` (`yes`, `no` or `maybe`) |
| `poll_answer` | `target`, `choices` (choice ids, one unless `multiple`) |
| `withdraw` | `target`: the `id` the space returned for the action being withdrawn; `withdraws`: that action's verb |

Every `act` also carries `ref`: a client-chosen UUID, the same on every retry of one action,
and new for each new action. No other fields are allowed in 0.1; a space MUST refuse unknown
fields (`invalid_action`), so that a signature never covers something the space ignored.

### 3.5 The answer

**Accepted** (201) or **held for review** (202):

```json
{
  "status": "accepted",
  "id": "https://demosville.civic.social/comments/cmt_552",
  "url": "https://demosville.civic.social/process/proc_4#cmt_552",
  "withdrawable": true,
  "ref": "8f1c2b7e-0d4a-4c1e-9a55-1f3b2c6d7e80"
}
```

`status` is `accepted` or `held` (with an optional plain-text `message`, at most 300
characters). For `withdraw`, `id` is the withdrawn action's id. A repeated `ref` (3.6) returns
the stored answer with its original status code.

**Refused:** `application/problem+json` (RFC 9457) with a `code`:

| HTTP | `code` | Meaning | Client may retry |
| --- | --- | --- | --- |
| 400 | `malformed` | Not a compact JWS, too large, wrong content type | no |
| 400 | `invalid_action` | `act` doesn't match 3.4 | no |
| 401 | `bad_type` | `typ` or `alg` wrong | no |
| 401 | `untrusted_did` | DID method or host not in `did_hosts` | no |
| 401 | `wrong_audience` | `aud`, `htm` or `htu` doesn't match | no |
| 401 | `expired` | Outside the time window | with a new signature |
| 401 | `bad_signature` | Signature doesn't verify against an `assertionMethod` key | no |
| 403 | `not_member` | The DID isn't a member here yet; `join` names the page | after joining |
| 403 | `not_eligible` | A member, but not allowed this action (for example, not a resident) | no |
| 403 | `assurance_required` | This action needs `assurance: "passkey"` | with a passkey |
| 403 | `blocked` | The DID or the client is blocked by the space | no |
| 404 | `unknown_target` | No such target, or not visible | no |
| 409 | `replayed` | `jti` already used | no |
| 409 | `ref_conflict` | `ref` already used for a different action | no |
| 410 | `closed` | The target no longer accepts this action | no |
| 413 | `too_long` | `content` over the target's `max_length` | after editing |
| 422 | `not_accepted` | The target doesn't accept this verb, or the answer isn't one of its options | no |
| 422 | `not_withdrawable` | That action can't be withdrawn | no |
| 429 | `rate_limited` | Too many from this DID or client; `Retry-After` set | after the wait |
| 503 | `did_unavailable` | The DID log couldn't be read just now; `Retry-After` set | after the wait |
| 503 | `unavailable` | The space can't take actions just now | after the wait |

`detail` MAY carry a plain-text explanation (at most 300 characters) and `join` the join page.

### 3.6 Replay and idempotency

- A space MUST remember each `(iss, act.ref)` with its **final** answer for 24 hours: 201, 202,
  and the refusals no retry can change (`blocked`, `unknown_target`, `closed`, `not_accepted`,
  `too_long`, `not_withdrawable`, `not_eligible`). It MUST NOT store a retryable answer
  (`not_member`, `assurance_required`, `rate_limited`, `did_unavailable`, `unavailable`,
  `expired`), so the same action can succeed once the cause is fixed. A request whose
  `(iss, ref)` has a stored answer and whose `act` is identical gets that answer, whatever its
  `jti` or `assurance`: that is how a client safely retries after a timeout. A different `act`
  with a known `ref` is `ref_conflict`.
- For a new `ref`, a space MUST remember each `jti` until `exp` plus 60 s and refuse a repeat
  (`replayed`).
- `aud`, `htm` and `htu` stop a JWS for one space or endpoint being used at another. `typ`
  stops a sign-in note being used as an action. The other way round, an action can't pass as a
  sign-in note: it has no `nonce`, Mosaic ID refuses to sign an action whose `aud` is a
  registered client's origin (5.2), and sign-in verifiers refuse `typ: "mosaic-action+jwt"`
  (5.5).

## 4. How a space verifies a request

In this order, stopping at the first failure. Each step is a conformance case (section 8).

1. `Content-Type` is `application/jwt`; the body is a compact JWS of at most 16 KB (`malformed`).
2. The header's `alg` is exactly `EdDSA` and `typ` exactly `mosaic-action+jwt` (`bad_type`).
3. `iss` equals `sub`, is a `did:webvh`, and `kid` starts with `iss` followed by `#`
   (`untrusted_did`).
4. The DID's host is in `did_hosts`, checked **before** any request (`untrusted_did`).
5. `aud`, `htm` and `htu` match the manifest exactly (`wrong_audience`).
6. `iat` is not more than 60 s in the future, `exp` has not passed by more than 60 s, and
   `exp - iat` is at most 300 (`expired`).
7. The DID log is read through the space's fetch guard (cached at most 10 minutes), verified, and
   not deactivated; the signature verifies with the key the **current** document lists under
   `assertionMethod` for `kid` (any key in the header is ignored). If a cached document fails,
   the log is read once more, fresh, at most once per DID per minute (`bad_signature`,
   `did_unavailable`).
8. `act` matches 3.4 exactly (`invalid_action`).
9. Idempotency and replay, as 3.6.
10. `client` is not blocked and the DID is not blocked (`blocked`).
11. The target exists, is visible, is on this space, currently accepts this verb, is not past
    `closes_at`, and the answer is one of its options (`unknown_target`, `closed`,
    `not_accepted`, `too_long`, `not_withdrawable`); for `withdraw`, the action named is this
    DID's and its verb is `withdraws`. If the target is marked `"passkey"`, `assurance` is
    `passkey` (`assurance_required`).
12. The DID is a member of the space and allowed this action under the space's own rules
    (`not_member`, `not_eligible`).
13. Limits and moderation (section 6), then the action is recorded and answered.

A space MUST record, for every accepted or held action, the JWS itself, so it can later show who
said what with proof.

## 5. Mosaic ID: grants and signing

### 5.1 The grant (once)

1. The River creates a grant attempt (state, PKCE verifier) and sets a 10-minute `HttpOnly`,
   `Secure`, `SameSite=Lax` state cookie, then redirects to
   `https://id.mosaic.social/grant?response_type=code&client_id=https://river.mosaic.social&redirect_uri=https://river.mosaic.social/api/auth/grant/callback&state={state}&code_challenge={S256}&code_challenge_method=S256&scope=space-actions:comment%20space-actions:support%20space-actions:rsvp%20space-actions:poll_answer`.
2. Mosaic ID checks `client_id` and the exact `redirect_uri` (as for sign-in), and shows:
   "**Mosaic River** asks to send these as you (your Mosaic ID): comments, support, RSVPs and poll
   answers, to Mosaic spaces you choose in the River. You'll see each one in the River before it's
   sent. Mosaic ID keeps a list of everything it signs. You can stop this at any time on your
   account page." It runs a passkey check (user verification required), records the grant, and
   redirects to `redirect_uri?state={state}&code={code}` (one use, 60 s).
3. The callback sends `Referrer-Policy: no-referrer` and redirects at once so the code doesn't
   linger (as spec 4.6's sign-in callback). The River requires the cookie to match `state`,
   consumes the attempt, and calls
   `POST https://id.mosaic.social/grant/token` (form body: `grant_type=authorization_code`, `code`,
   `redirect_uri`, `code_verifier`; HTTP Basic with the client id and `MOSAIC_ID_CLIENT_SECRET`).
4. Mosaic ID answers `{ "grant_token": "…", "token_type": "mosaic-grant", "scope": "…", "sub": "did:webvh:…" }`.
   The code is bound to the client, the redirect URI and the PKCE challenge, and works once.
   The River refuses a `sub` that isn't the signed-in account's DID (and revokes it), then stores
   the token encrypted (ADR-010 §5). Mosaic ID keeps only its SHA-256.
5. If the person's DID document has no `assertionMethod`, Mosaic ID appends a DID log entry
   adding `assertionMethod: ["#key-1"]` before step 2 redirects.

A grant lasts until revoked; one unused for 180 days lapses on both sides.

### 5.2 Signing (each action)

`POST https://id.mosaic.social/actions/sign`, client-authenticated, JSON
`{ "grant_token": "…", "aud": "…", "htu": "…", "act": { … } }`.

Mosaic ID: authenticates the client; finds the grant by the token's hash (`grant_revoked` if
missing, revoked or lapsed); checks `act` against 3.4 and that the grant's scope covers its verb
(for `withdraw`, the scope of the verb named in `withdraws`); checks `htu` is `https:` and `aud`
is a `did:web` or an `https:` origin that is **not** a registered client's origin (so an action
is never aimed at a sign-in verifier), and whose `aud` and `htu` hosts are in
`IDENTITY_SPACE_ACTION_HOSTS` (`scope` otherwise; ADR-012 item 9); applies the person's limits (200 signatures an hour,
1,000 a day: above the River's own limits, so they bind only a River that ignores its own) and
the client's
(5,000 an hour across all people); signs with `assurance: "grant"` (this endpoint never signs
`passkey`; a target marked `"passkey"` goes through 5.3); writes `audit_log` `action_signed`
`{client, aud_host, verb, jti}`; returns `{ "jws": "…", "jti": "…", "exp": 1793050120 }`.

Errors: 401 `invalid_client`, 401 `grant_revoked`, 403 `scope`, 422 `invalid_action`,
429 `rate_limited` (with `Retry-After`).

### 5.3 Step-up (an action marked `"passkey"`)

1. The River `POST /actions/requests` (client-authenticated) with the grant token, `aud`, `htu`,
   `act`, and `display` (plain-text target title and choice labels, at most 500 characters in all).
   Mosaic ID answers `{ "request_uri": "urn:mosaic:action-request:…", "expires_in": 300 }`.
2. The River stores a step-up attempt (state, PKCE verifier) for the previewed row, sets a state
   cookie, and sends the member to
   `https://id.mosaic.social/actions/confirm?client_id=…&request_uri=…&state=…&code_challenge=…&code_challenge_method=S256&redirect_uri=https://river.mosaic.social/api/auth/step-up/callback`.
3. Mosaic ID shows the action (verb, space host, content or choice ids) and the River's
   `display` labelled "as Mosaic River describes it", and runs a passkey check that must use
   **one of the grant's person's passkeys** (anyone else's is refused). It redirects back with a
   code bound to the client, the request, the redirect URI and the PKCE challenge: one use, 60 s.
4. The callback (`Referrer-Policy: no-referrer`, immediate redirect) checks the state cookie,
   consumes the attempt, calls `POST /actions/token` (client-authenticated, the code and
   `code_verifier`) and stores the JWS (`assurance: "passkey"`) on the previewed row. It sends
   nothing to the space. The member is back on the preview, now marked "Confirmed with your
   passkey", and Send (an Origin-checked click at the current session epoch, ADR-010 §10)
   delivers it. A JWS not sent before its `exp` is dropped and the step-up starts again.

### 5.4 Revoking

`POST /grant/revoke` (client-authenticated, the grant token) answers 204. The account page at
Mosaic ID lists each grant (client, scopes, created, last used) with Revoke, and "Signed for apps"
(the `action_signed` lines: when, space host, verb). A recovery revokes every grant of the person.
The daily job deletes action requests older than a day, and grants that lapsed or were revoked
more than 30 days ago (their `action_signed` lines stay in `audit_log`).

### 5.5 Clients and the sign-in note

- Each registered client has capabilities: `signin` (the sign-in note, ADR-002) and
  `space-actions` (grants and signing). The River has both; a Civic Hub registered to sign people
  in has `signin` only, so it can't ask for grants. Mosaic ID refuses grant and signing requests
  from a client without `space-actions`.
- Sign-in notes gain `typ: "mosaic-signin+jwt"` in their header. Every sign-in verifier (the
  River's callback, and a hub's) refuses a JWS whose `typ` is `mosaic-action+jwt`, and keeps
  accepting notes with no `typ` until every note carries one.
- Space Actions is for any Mosaic space, but a space only verifies actions; it never relies on the
  sign-in note. A space outside the Foundation that wants "Sign in with Mosaic ID" waits for the
  OAuth profile ADR-002 requires.

## 6. Moderation and abuse limits at the space

A conforming space:

- MUST rate-limit per DID and per `client`, and answer `rate_limited` with `Retry-After`.
  Suggested: 10 comments an hour and 60 actions an hour per DID.
- MUST be able to block a DID, and SHOULD be able to block a `client`.
- MUST apply the same content rules and moderation to signed actions as to its own forms (word
  filters, review queues, hiding), and MAY hold actions for review (`held`).
- SHOULD hold the first comments from a DID it hasn't seen before.
- MUST NOT use `name` to identify anyone; the DID is the identity. It MAY show its own name for
  the member instead.
- MUST keep the JWS of every accepted or held action for as long as it keeps the action.
- MUST refuse actions on hidden, archived or withdrawn targets.
- SHOULD tell members, on its join page or terms, that actions sent through a client are theirs
  and are kept with their signature.

## 7. The River's part

1. **Reading the advertisement.** The hub adapter (and any Mosaic space's) stores the manifest's
   `actions` block in `spaces.manifest.actions` and each activity's `civic:actions` in a new
   nullable `river.items.actions` column (jsonb; the refresh writes it, so `river_app` gets UPDATE
   on it). Each entry is re-checked when read: known verb, listed in the manifest, `target` on the
   space's host, values within the limits of 2.2, labels as plain text. Until the column exists the
   adapter stores nothing and no actions show.
2. **What shows.** Only on spaces whose host is in `SPACE_ACTION_HOSTS` (default `civic.social`
   and its subdomains; the stand-in's host in tests), until the OAuth profile ADR-002 plans exists
   (ADR-012 item 9). On a live card from such a space whose manifest has a valid `actions` block: a
   button per known verb its item lists that isn't past `closes_at` and whose stream hasn't ended:
   "Comment", "Support", "RSVP", "Answer the poll". Visitors see them too; a click asks them to
   sign up. The buttons sit in the card's footer beside Open ↗ and don't open the card.
3. **First use.** With no grant, the first click explains: "To comment from the River, let
   Mosaic River send actions as your Mosaic ID. You'll see each one before it's sent." Continue
   goes to Mosaic ID (5.1) and back to the same card. The first action at each space adds one line
   to its preview: "demosville.civic.social will see your Mosaic ID (its DID) with this."
4. **Comment and poll answer** open a composer with the text box (or the choices), a live
   character count against `max_length`, and Preview. The preview shows the text as the space will
   get it, the target's title, the space's host, "as your Mosaic ID", and, under "Show exactly
   what will be sent", every claim Mosaic ID will sign: `iss`, `sub`, `aud`, `htm`, `htu`,
   `client`, `assurance` and `act` with their values, and `iat`, `exp` and `jti` named as "set by
   Mosaic ID when it signs" (ADR-010 §4). Send signs and posts.
5. **Support and RSVP** are toggles: Support shows "Supported ✓" once sent and Withdraw beside it;
   RSVP is a three-way choice where changing the answer sends a new `rsvp`.
6. **Sending.** One request from the page (for a `"passkey"` target, the Send after the step-up,
   5.3): the River checks the session, then takes the limits' lock, writes the row and commits
   before any outbound request, so no lock or pooler connection is held while it waits. It then
   asks Mosaic ID to sign (5.2), posts the JWS to the space, and stores the answer: two requests
   in a row, so up to about 12 s. A failure or timeout at Mosaic ID leaves the row `failed`
   (nothing reached the space). A timeout at the space leaves it `unknown`; for 24 hours (the
   space's `ref` window, 3.6) Try again reuses the row's `ref` with a fresh signature and the
   space answers from its stored result; after that only "Check on demosville.civic.social"
   is offered.
7. **Results.** `accepted`: "Sent to demosville.civic.social" with View ↗ (`url`). `held`:
   "demosville.civic.social will show it after review" plus the space's `message`.
   Every action appears in Your activity (ADR-010 §7) with Withdraw where `withdrawable`.
8. **Limits:** the River's per-account limits are ADR-010 §9's table (shared with fediverse
   posting); Mosaic ID's (5.2) sit above them.
9. **Messages** (every refusal maps to one):

| Code | The member sees |
| --- | --- |
| `not_member` | "demosville.civic.social needs you to join before you can do this." Join on demosville.civic.social ↗ (full page) |
| `not_eligible` | "demosville.civic.social doesn't allow you to do this." plus the space's detail |
| `closed` | "This has closed." (the button goes away) |
| `too_long` | "That's longer than demosville.civic.social allows ({n} characters)." |
| `rate_limited` | "demosville.civic.social asks you to wait until {time}." |
| `assurance_required` | The River runs the step-up (5.3) and sends again |
| `grant_revoked` (Mosaic ID) | "Your Mosaic ID no longer lets the River send actions. Allow it again?" |
| `rate_limited` (Mosaic ID) | "Mosaic ID asks you to wait until {time} before sending more." |
| `scope` (Mosaic ID) | "Your Mosaic ID hasn't allowed the River to send this kind of action. Allow it?" (a new grant with that scope) |
| `invalid_client`, a timeout or any other Mosaic ID failure | "Mosaic ID couldn't sign this just now. Nothing was sent." |
| `blocked` | "demosville.civic.social isn't accepting actions from you." |
| timeout at the space | "We couldn't tell whether demosville.civic.social got it." Try again (within 24 hours) |
| any other | "demosville.civic.social couldn't take this ({code})." |

## 8. Conformance

- **Reference code.** `src/shared/spaceActions/`: the types, the `act` schema, the JWS builder
  Mosaic ID uses, and the verifier of section 4 as a pure function with an injected DID resolver,
  clock and stores. Spaces MAY port it (AGPL-3.0).
- **Test vectors.** `tests/conformance/space-actions/vectors.json`: a fixed test DID log and key
  pair (for tests only, never trusted anywhere real), a manifest, and one signed request per case:
  a valid one for each verb, and one for each refusal in 3.5 that a request alone can trigger,
  each with the expected status and `code`. The vectors use a fixed clock.
- **The suite** (`tests/conformance/space-actions/suite.ts`) runs the vectors against any
  verifier: the reference one in unit tests, the stand-in space in API tests, and, by hand, a
  real space's endpoint configured to trust the test DID host (`npm run conformance:space-actions
  -- --endpoint https://…`; a dev tool run on demand, never in `ci`).
- **The stand-in space** (`tests/support/standInSpace/`): a manifest, a feed with `civic:actions`
  on a proposal (comment, support), an event (rsvp) and a poll (poll_answer, one target marked
  `"passkey"`), and an endpoint on the reference verifier, with switches for `not_member`, `held`
  and `rate_limited`. The River reaches it only through the guard's injected dispatcher, at
  `https://stand-in.example`, enabled by the test-only `TEST_STAND_IN_SPACE=1` (refused on Vercel,
  like the other test flags). Its DID resolver reads the local identity host's logs as the River's
  does (`TEST_DID_LOOPBACK`).

## 9. Acceptance checks

Unit tests use the vectors and fake timers; API tests run the River, the identity host and the
stand-in space locally against local Supabase; e2e uses Playwright's virtual authenticator.

1. The reference verifier accepts each valid vector and refuses each invalid one with the
   vector's status and `code`; step 4 makes no request for an untrusted DID host (counted in the
   injected resolver).
2. A JWS signed for one space's `aud` or `htu` is refused by another; a sign-in note sent as an
   action is refused `bad_type`; an action is refused by the River's sign-in callback (`typ`, and
   no `nonce`); Mosaic ID refuses to sign an action whose `aud` is a registered client's origin;
   a client with only `signin` can't get a grant.
3. A signature by a key listed only under `authentication` is refused `bad_signature`; after the
   grant adds `assertionMethod`, the same key verifies.
4. A repeated request with the same `ref` and `act` returns the stored answer and records one
   action; the same `ref` with another `act` is `ref_conflict`; a new `ref` with a used `jti` is
   `replayed`; after a `rate_limited` or `assurance_required` answer, the same `ref` sent again
   (after the wait, or with `assurance: "passkey"`) is processed, not answered from storage.
5. `exp - iat` of 301, `iat` 61 s ahead, and `exp` 61 s past are each `expired`; 59 s either way
   is accepted.
6. The hub adapter stores a fixture's `civic:actions` in `items.actions` and the manifest's block
   in `spaces.manifest.actions`; an entry with an unknown verb, a target on another host, or a verb
   the manifest doesn't list is dropped; a manifest whose endpoint is on another host gives no
   actions.
7. A stand-in proposal card shows Comment and Support; an item past `closes_at`, an ended
   stream's item, a sample, and a fediverse or Bluesky item show none.
8. First Comment click without a grant goes to Mosaic ID's grant page, which lists the four verbs;
   after the passkey check the member is back on the same card, the River holds an encrypted grant
   token (the stored bytes don't contain it), and Mosaic ID's table holds only its hash.
9. A grant whose `sub` isn't the signed-in account's DID is refused and revoked.
10. The comment preview shows the text, the target title, the space host, and every claim with
    its value except `iat`, `exp` and `jti`, which are named; the JWS the stand-in receives has
    exactly those values; a Send after 15 minutes is refused as out of date.
11. A sent comment shows "Sent to stand-in.example" and appears in Your activity with View ↗;
    Withdraw sends `withdraw` with the returned id and the row reads Withdrawn, its text erased.
12. Support toggles on at once, then shows Withdraw; when the stand-in refuses, the toggle goes
    back and the message shows.
13. A `"passkey"` poll goes through Mosaic ID's confirm page, which shows the choice ids and the
    River's labels as the River's and refuses a passkey that isn't the grant's person's; back on
    the River nothing has been sent until the member presses Send, and then the stand-in receives
    `assurance: "passkey"`; the step-up code works once, within 60 s, with its PKCE verifier only;
    without the step-up the stand-in answers `assurance_required` and the River starts it. A
    comment-only grant can't withdraw a support (`scope`).
14. With the stand-in set to `not_member`, the message shows Join ↗ opening the stand-in's join
    page in a new tab; set to `held`, the review message shows and the row reads Held.
15. Mosaic ID: a revoked grant gives `grant_revoked` and the River asks to allow again; a
    recovery revokes every grant of that person; the 201st signature in an hour is `rate_limited`;
    `audit_log` has one `action_signed` per signature with no content.
16. River limits: the 31st text action in an hour answers 429 and reaches neither Mosaic ID nor
    the stand-in (counted); two Sends racing for the last allowance send one.
17. "Sign out everywhere" in one browser, then Send from a second browser's previewed comment:
    401, and nothing reaches Mosaic ID or the stand-in.
18. A timeout from the stand-in (fake timers) leaves the row `unknown` with Try again; Try again
    re-signs with the same `ref` and the stand-in records one comment; 24 hours later only "Check on"
    is offered. A timeout at Mosaic ID leaves the row `failed` and nothing reaches the stand-in.
19. Every River request to the stand-in and Mosaic ID goes through the guard with redirects off: a
    3xx from either is a failure and no second request is made. The grant and step-up callbacks
    answer with `Referrer-Policy: no-referrer` and an immediate redirect.
20. `river_app` as member A can't read member B's `member_actions` or grant tokens; no API
    response, log line or error contains a grant token, a JWS, or a client secret.
21. axe finds no serious issue on a card with actions, the composer, the preview and Your
    activity; each is reachable and usable from the keyboard.
22. A space outside `SPACE_ACTION_HOSTS` with a valid `actions` block shows no actions; Mosaic ID
    refuses to sign for an `aud` or `htu` outside `IDENTITY_SPACE_ACTION_HOSTS` (`scope`), even
    for a River request that skips its own check; Mosaic ID refuses to start with a `signin`-only
    client outside `civic.social`.

## 10. Out of scope in 0.1

Secret ballots and any vote with receipts; credentials and eligibility proofs (Verifiable
Credentials); asking a space for a member's own state ("have I supported this?"); threaded
replies to comments; media; editing; pairwise DIDs; DIDs from hosts other than Mosaic ID; signers
other than Mosaic ID; spaces pushing results back to the River; actions on fediverse or Bluesky
items (those go through ADR-011).
