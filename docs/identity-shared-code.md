# What Mosaic ID shares with the River, and who keeps what

Part 3 of preparing Mosaic ID (the identity host, `APP=identity`) to move to its own repository.
This is an inventory and a proposal; nothing here is moved yet. Counted on `main` at c8f6c4d
(2026-10-27) by following every relative import from `src/identity/**`, `identity/api/index.ts`
and `scripts/recover-dids.ts`.

## 1. What identity code imports from outside `src/identity/`

| File | Imported by (identity side) | What it gives | Proposal |
| --- | --- | --- | --- |
| `src/shared/http/vercel.ts` (24 lines) | `identity/api/index.ts` | Express app to Vercel handler | **Copy** |
| `src/shared/routes.ts` (14) | through `src/app.ts` | `GET /health` | **Copy** (inline it into Mosaic ID's app) |
| `src/shared/appName.ts` (12) | through `src/config/env.ts` | `APP` names and default ports | **Drop** in Mosaic ID (one app, no `APP` switch); River keeps |
| `src/shared/fetch/` (6 files, 682 lines): `index`, `guard`, `addresses`, `errors`, `fixtures`, `loopback` | `src/identity/email/index.ts` (Resend) | The fetch guard (ADR-001) and the fixture replay used in tests | **Copy whole**, except `loopback.ts` (see below) |
| `src/config/env.ts` (221) | `config.ts`, `email/`, `flows/testRoutes.ts`, `http.ts`, `keys/`, `routes.ts`; `src/db/pool.ts` | Every variable both apps read, `checkEnv()`, the test-only refusal | **Copy and cut**: Mosaic ID keeps its own variables only (the `.env.identity.example` list); River drops `IDENTITY_*`, `RP_ID`, `RIVER_CLIENT_ORIGINS`, `EMAIL_*`, `RESEND_API_KEY` |
| `src/db/pool.ts` (102) | `src/db/context.ts`, `scripts/recover-dids.ts` | The pool, verified TLS, `DATABASE_CA_CERT` | **Copy** (both keep identical copies) |
| `src/db/context.ts` (247) | 10 identity files | `forIdentity()`, `Db`, `ClientSource`, the transaction helper | **Copy and cut**: Mosaic ID keeps `forIdentity()` and the shared transaction core; River keeps `forInstance()`, `forAccount()`, `forHost()` |
| `src/db/tables.ts` (52) | through `src/db/context.ts` | `RIVER_TABLES` and `IDENTITY_TABLES` | **Split**: each keeps its own list |
| `src/app.ts` (24) | `identity/api/index.ts` | `createApp(kind)` | **Replace**: Mosaic ID gets its own `createApp()` (see 1.1) |

Nothing else under `src/shared/` reaches identity code today: `items/`, `sanitize/`, `hosts/` and
`spaceActions/` are River-only (and tests'). B2 will make Mosaic ID import `spaceActions/`'s JWS
builder (section 3).

Third-party packages on the identity side: `express`, `pg`, `undici` (inside the guard),
`@simplewebauthn/server` and `@simplewebauthn/browser` (the passkey script, built with `esbuild`),
`didwebvh-ts`, `@vercel/functions`. The River uses `didwebvh-ts` too, to verify DID logs.

### 1.1 One thing to fix before the move: the mosaic-id bundle contains the River

`identity/api/index.ts` calls `createApp("identity")` from `src/app.ts`, which imports
`riverRoutes` as well as `identityRoutes`, so Vercel bundles all of `src/river/` (adapters, feed,
acting, the sanitizer) into the identity function. It never runs, but it is code the identity host
ships and its secrets sit next to. A small River PR can give the identity side its own
`src/identity/app.ts` (shared routes plus `identityRoutes()`), have `identity/api/index.ts` and
`src/index.ts` (for `APP=identity`) use it, and add a check that nothing reachable from
`identity/api/index.ts` lies under `src/river/` (the import walk above, as a unit test). That is
also the exact file list Mosaic ID's repository starts from. Proposed as a follow-up, not built.

### 1.2 Contracts that are not imports

The two apps share no code at runtime but must agree on these. Moving Mosaic ID out turns each
into a cross-repository contract, so each should have test vectors both repositories run (as
`tests/conformance/space-actions/` does for space actions):

- **The sign-in note** (spec 4.6, ADR-002): signed by `src/identity/note.ts`, verified by
  `src/river/auth/note.ts`.
- **The DID log** (`/u/{code}/did.jsonl`, did:webvh): written by `src/identity/did/`, read by
  `src/river/auth/did.ts`. Today they agree because both pin the same `didwebvh-ts`.
- **The authorize request and callback** (`client_id`, exact `redirect_uri`, `state`, `nonce`), and
  the deployment settings that pair them: `RIVER_CLIENT_ORIGINS` on one side, `IDENTITY_ORIGIN` and
  `TRUSTED_DID_HOSTS` on the other.
- **Test-only**: `src/shared/fetch/loopback.ts` lets the River read the identity dev server's DID
  logs over loopback http (`TEST_DID_LOOPBACK=1`). It is the River's code (it reads), so the River
  keeps it and Mosaic ID drops it.

## 2. Proposal: what Mosaic ID copies and what the River keeps

**Mosaic ID copies** (each copied file starts with a line naming its source, `river@<sha>:<path>`,
so drift is visible, like `docs/reuse/`):

- `src/shared/fetch/` without `loopback.ts`: the guard is security-critical and small enough to
  copy. Two copies have to be patched together; if they keep changing in step, that is the time
  to make the guard a package as well.
- `src/db/pool.ts`; the identity half of `src/db/context.ts` and `src/db/tables.ts`.
- Its own cut of `src/config/env.ts` and `.env.identity.example`.
- `src/shared/http/vercel.ts`, the `/health` route, the lint rules behind constraints 1 to 3 in
  `eslint.config.js` (`tests/unit/lintBoundaries.test.ts` with them), `tsconfig*.json`, and the
  workflows' shape (`ci.yml`, `deploy-migrations.yml` for its own migration history, part 2).
- Everything it alone uses: `src/identity/`, `identity/` (Vercel root), `scripts/recover-dids.ts`,
  `npm run build:identity-client`, `docs/` sections about the identity host (ADR-002 stays shared
  in spirit: both repositories link it).
- Its tests: unit `identityDid`, `identityErrorLog`, `identityHost`, `identityKeys`, `identityNote`;
  API `identity`; API db `identity`, `emailReservation`, `recoveryTiming`, `identityDailyJob` (part
  1); the Resend fixtures under `tests/fixtures/http/`.

**The River keeps** everything else, and after the move deletes its identity side:
`src/identity/`, `identity/`, `forIdentity()`, `IDENTITY_TABLES`, the identity variables in
`env.ts`, `scripts/recover-dids.ts` and `npm run dev:identity`.

**Tests that span both** (`tests/api/signin.test.ts`, `tests/e2e/signin.spec.ts`,
`tests/e2e/identity.spec.ts`, `identityHelpers.ts`, API db `sessionRevocation`) need a running Mosaic ID.
Proposal: the River's CI starts Mosaic ID from a pinned release (its repository at a tag, or a
container image) instead of this repository's code, and keeps these tests. Until then they stay as
they are.

## 3. The space-actions code as a package (not built)

`src/shared/spaceActions/` (8 files, about 1,020 lines) plus `src/shared/hosts/` (104 lines, used
only by the verifier) is the reference code of Mosaic Space Actions 0.1 (ADR-012, spec section
8). Three parties use it: the River (types, the manifest reader, the act check), Mosaic ID (the
JWS builder, from B2) and every space (the verifier; the Civic Hub first). After the split, a
package is the only way to share it without three copies.

What that would take:

1. **An ADR** (a dependency with lasting effects, so `needs-adam`): name, home and license. A
   name such as `@mosaic-foundation/space-actions`; home either its own repository or a workspace
   inside Mosaic ID's (Mosaic ID is the signer, so it changes first). License: the code says spaces
   may port it under AGPL-3.0; a library the Civic Hub and third-party spaces import may be better
   under a permissive license or with a linking exception. That choice is Adam's.
2. **Make it standalone.** It is already pure: no network, the DID resolver is handed in, only
   `node:crypto` and `didwebvh-ts` (`multibaseDecode`). Move `hosts/` in with it. Ship
   `memoryStores.ts` under a `/testing` subpath, not the main export.
3. **Build and publish.** ESM, compiled JS plus `.d.ts`, `engines.node >= 24`, versioned with the
   protocol (`0.1.x` while the protocol is 0.1). Publish to npm from CI with provenance, or install
   from a git tag; consumers pin an exact version in their lockfile. An npm organization is free
   for public packages; this needs Adam to create it (or to choose GitHub Packages).
4. **Move its tests with it**: unit `spaceActionsCore`, `spaceActionsVerify`,
   `spaceActionsConformance`, `hostList`; `tests/conformance/space-actions/` (the signed vectors and
   their generator, `scripts/space-actions-vectors.ts`); `tests/support/spaceActions/testDid.ts`.
   The vectors become the package's published conformance suite. The stand-in space
   (`tests/support/standInSpace/`) stays in the River, built on the package.
5. **Switch the consumers**: the River imports the package instead of `src/shared/spaceActions/`;
   Mosaic ID's signer and the Civic Hub's verifier start on it.

About two small PRs once the ADR is accepted: the package with its tests and CI, then the River's
switch.
