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

Set for Production and Preview, except `DATABASE_URL` and `SESSION_SECRET`: Production only (see
Previews):

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
