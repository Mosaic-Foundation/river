# Production deploy checklist (M11)

For Adam: the steps a thread can't take (they need the Vercel and Supabase dashboards, DNS and the
`needs-adam` merges). Names only; values never go in git. Sources: `.env.example`,
`.env.identity.example`, spec Appendix D, ADR-006.

## Before

- [ ] The milestone PRs are merged in order (M5 to M11); `deploy-migrations` applied every
      migration to the hosted project (Actions tab, green on each merge).
- [ ] On the hosted project, once, in the SQL editor: `ALTER ROLE river_app LOGIN PASSWORD '…'` and
      the same for `identity_app`, each with its own generated password (spec 3).
- [ ] `pg_cron` is enabled and the daily job is listed (`SELECT * FROM cron.job`).
- [ ] The project isn't paused (free projects pause after about a week idle).

## Previews

Vercel previews no longer have `DATABASE_URL` or `SESSION_SECRET`, by design (2026-10-26). A
preview builds and serves the UI, but its pages load no data and nobody can sign in there. Check a
change with CI (`ci`: unit, API against a local Supabase stack, and e2e) and locally
(`npm run check`, `npm run test:api`, `npm run test:e2e`), not with a preview.

## Vercel project `river` (repo root)

Set for Production and Preview, except `DATABASE_URL`, `SESSION_SECRET` and `RIVER_TOKEN_KEY`:
Production only (see Previews):

| Variable | Value |
| --- | --- |
| `APP` | `river` |
| `DATABASE_URL` | pooler URI as `river_app.[project-ref]`, port 6543, `?sslmode=verify-full` |
| `DATABASE_CA_CERT` | PEM from Dashboard > Database > SSL Configuration |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -hex 32`); changing it signs everyone out |
| `RIVER_PUBLIC_ORIGIN` | `https://river.mosaic.social` (the production vercel.app origin until DNS) |
| `IDENTITY_ORIGIN` | `https://id.mosaic.social` (the mosaic-id vercel.app origin until DNS) |
| `TRUSTED_DID_HOSTS` | `id.mosaic.social` (the mosaic-id vercel.app host until DNS) |
| `INSTANCE_HOST_ALIASES` | the River's vercel.app hosts, until river.mosaic.social resolves |
| `RIVER_TOKEN_KEY` | **Production only.** 32 random bytes, base64 (`openssl rand -base64 32`). Seals the credentials the River holds to act for members (ADR-010 §5). Never in the `mosaic-id` project. Needed before the first PR that stores a credential (A2) deploys |

Never set: `FETCH_FIXTURES_DIR`, `TEST_ROUTES`, `TEST_CLOCK_NOW`, `TEST_DID_LOOPBACK` (the app
refuses to start with them on Vercel or with `NODE_ENV=production`), `PORT`, `VERCEL_ENV` (Vercel
sets it).

## Vercel project `mosaic-id` (Root Directory `identity/`)

Set for Production and Preview. Only this project holds `IDENTITY_MASTER_KEY` and `RESEND_API_KEY`.

| Variable | Value |
| --- | --- |
| `APP` | `identity` |
| `DATABASE_URL` | pooler URI as `identity_app.[project-ref]`, port 6543, `?sslmode=verify-full` |
| `DATABASE_CA_CERT` | the same PEM |
| `SESSION_SECRET` | its own 32+ random characters, not the River's |
| `IDENTITY_MASTER_KEY` | 32 random bytes, base64; keep an offline copy |
| `IDENTITY_RECOVERY_PUBLIC_KEY` | public half of the offline recovery key (`npm run recover-dids -- --print-public-key --key-file …`) |
| `RP_ID` | `id.mosaic.social` |
| `IDENTITY_PUBLIC_ORIGIN` | `https://id.mosaic.social` |
| `RIVER_CLIENT_ORIGINS` | `https://river.mosaic.social` (exact origins, comma-separated) |
| `EMAIL_TRANSPORT` | `resend` (or `log` until Resend's DNS records are in); `capture` is refused in Production |
| `RESEND_API_KEY` | from Resend |
| `EMAIL_FROM` | `Mosaic ID <id@mosaic.social>` |

Never set: `FETCH_FIXTURES_DIR`, `TEST_ROUTES`, `PORT` (the test-only ones are refused on Vercel
and with `NODE_ENV=production`).

## If RIVER_TOKEN_KEY leaks (acting credentials)

ADR-010 §5: the database alone gives nothing usable, but the database together with
`RIVER_TOKEN_KEY` gives every token the River holds for members' linked accounts. If both may have
leaked (or the key alone, to be safe), revoke everything, then rotate. Run it from your own
machine, on a checkout of `main`.

1. Put the production values in `.env.revoke` at the repo root (gitignored): `DATABASE_URL` (the
   `river_app` pooler URI, as in the table above), `DATABASE_CA_CERT`, and the current
   `RIVER_TOKEN_KEY`.
2. `npm run revoke-links`: a dry run. It changes nothing, and lists each server with its number of
   links and how many open with this key.
3. `npm run revoke-links -- --apply`: for every active link, it asks the server to revoke the token
   (`POST /oauth/revoke`, redirects refused) and deletes the token whatever the answer. Mosaic ID
   grant tokens are deleted. Then every app registration is deleted, since its client secret leaked
   too, and the next link registers a fresh app. The report names servers and counts only.
4. Mosaic ID: revoke every grant of the River's client in one statement. B2 adds this step and its
   command; until B2 ships there are no grants.
5. Rotate: generate a new `RIVER_TOKEN_KEY` (`openssl rand -base64 32`), replace it in the `river`
   project (Production), and redeploy. Nothing needs re-wrapping: the old credentials are gone.
   If the database itself leaked, also change `river_app`'s password (`ALTER ROLE river_app
   PASSWORD '…'` in the SQL editor) and update `DATABASE_URL`.
6. Tell members. Each link now reads "Your link to … stopped working. Link it again." For every
   server the report lists as "not confirmed", members linked there should also remove Mosaic
   River from that server's authorized apps (Preferences → Account → Authorized apps on Mastodon).
7. Delete `.env.revoke`.

## DNS and after

- [ ] `river.mosaic.social` → the `river` project; `id.mosaic.social` → `mosaic-id`; Resend's SPF and
      DKIM records for mosaic.social (Appendix E).
- [ ] When the identity host moves from its vercel.app host to id.mosaic.social, update `RP_ID`,
      `IDENTITY_PUBLIC_ORIGIN`, the River's `IDENTITY_ORIGIN` and `TRUSTED_DID_HOSTS`. Accounts made
      on the vercel.app host are test accounts (passkeys and DIDs name their host; Appendix D).
- [ ] Smoke: `https://river.mosaic.social/api/health` and `https://id.mosaic.social/health`; open the
      River (live items from three hubs and six accounts plus samples); sign up with a passkey;
      follow and mute something; switch to Civic; download `/api/me/export`.
- [ ] `npm run test:live` once from Adam's machine (check 32).
