# ADR-002: Identity host, custodial did:webvh and the v1 sign-in

- **Date:** 2026-10-20
- **Status:** Accepted
- **Scope:** `src/identity/`, the River's sign-in callback, sessions
- **Extends:** Civic Hub CLAUDE.md constraint 4 (no proprietary auth, DID-compatible)

## Context

Adam wants identity that is nearly unnoticeable today and portable later: one account across the Mosaic ecosystem, a DID that belongs to the person, and a host that can be replaced (Decisions Log; spec 4.6).

## Decision

- A separate identity host (`id.mosaic.social`) creates one `did:webvh` v1.0 per person (`portable: true`, SCID stable across moves), with an Ed25519 key held for the person under envelope encryption (AES-256-GCM data key wrapped by `IDENTITY_MASTER_KEY`). Adam keeps an offline copy of the master key.
- Each DID's `updateKeys` lists two keys: the person's custodial key and the Mosaic recovery key, whose private half Adam keeps offline and which never touches a server. If the master key or a custodial key is lost, `npm run recover-dids`, run on Adam's machine, re-keys the affected DIDs; people keep their DID, account, passkeys and email.
- People sign up and in with passkeys (`@simplewebauthn` v14, discoverable credentials, user verification required). An email address is required for recovery: a single-use, 15-minute link adds a new passkey to the same person and DID.
- The River signs people in by redirect. It sets a short-lived `HttpOnly`, `SameSite=Lax` cookie holding a one-time `state`; the identity host returns a compact JWS (EdDSA) note `{iss, sub, aud, nonce, iat, exp}` signed with the person's key; the River's callback (`/api/auth/callback`) requires the cookie to match `state`, consumes the attempt, accepts only DIDs on `TRUSTED_DID_HOSTS`, and verifies the note against the key in the resolved DID document.
- The River keys accounts by (instance, login kind, SCID), never by email. It never sees email addresses or private keys.

## Alternatives considered

- Wallet sign-in with OpenID4VP first: too much friction for v1; kept for later.
- did:scid: still a draft with no implementations.
- did:web: not portable.
- Supabase Auth or a big-tech login: proprietary; breaks constraint 4.
- Passkeys without email: a lost passkey would lose the account (rejected by Adam).

## Consequences

Sign-in is one tap for most people and the DID is real and resolvable. Mosaic is custodian of keys for now, and email is the weakest link for takeover; key-custodian or social recovery replaces it later. The signed note must become an atproto-style OAuth profile (PAR, PKCE, DPoP) before any third-party site relies on it. Passkeys and DIDs are bound to the host name, so accounts made on vercel.app hosts before DNS are test accounts.
