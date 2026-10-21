# Feed performance report (check 34)

Manual, not a gate (spec 6, check 34): `GET /api/feed` with 20 follows and a warm cache. Measured
2026-10-21 by the M11 thread on its cloud container, against the local stack.

## Result

A member with 20 follows gets the first page of their feed in **25 ms median, 32 ms p95**
(100 requests, warm cache). Visitors' answers are a little faster (17 ms median). Opening a fresh
database for the first time, when every seed space is resolved and fetched from the recordings,
took 403 ms.

| Request | Runs | Min ms | Median ms | Mean ms | p95 ms | Max ms | Priming ms | Items | KiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Member, Everything, first page | 100 | 18.6 | 25.0 | 25.5 | 31.7 | 47.7 | 25.6 | 30 | 36.6 |
| Member, Civic mode, first page (with panel) | 100 | 20.0 | 25.9 | 26.0 | 30.9 | 37.4 | 27.3 | 30 | 25.4 |
| Member, search "vote" | 100 | 15.5 | 18.5 | 19.3 | 23.3 | 27.8 | 25.5 | 6 | 8.5 |
| Visitor, Everything, first page | 100 | 12.5 | 17.4 | 17.9 | 23.6 | 33.8 | 14.5 | 30 | 36.0 |

Times are wall-clock from the client: request sent to the last byte of the body read. "Priming"
is the first request of the row, before 5 unrecorded warm-up requests.

## How it was measured

- Script: `scripts/perf-feed.ts` (`npx tsx scripts/perf-feed.ts`; `PERF_RUNS` sets the runs per
  row, default 100). It refuses any API URL that isn't on loopback.
- Server: `npm run dev` (tsx watch, not a compiled build) on :3000 with the `test:api` settings:
  `FETCH_FIXTURES_DIR=tests/fixtures/http` and `TEST_CLOCK_NOW=2026-10-21T00:00:00.000Z`, so every
  upstream request is a recorded response replayed in-process. No real host was contacted.
- Database: the local Supabase Postgres in Docker (`npx supabase db reset` just before), as
  `river_app`, with no pooler and no TLS.
- Machine: 4 x Intel Xeon @ 2.80GHz, Node v24.22.0. The client and the server share it.
- The member: a fresh account signed in through the River's real callback with a test DID
  (`tests/api/helpers/member.ts`). 20 follows: the 16 seed follows copied at sign-up (3 hubs,
  6 fediverse accounts, 7 sample spaces) plus 4 "just this stream" follows of open hub processes,
  counted through `GET /api/me/export`. The member's circles are the 5 default ones.
- Warm cache: every followed space was refreshed less than 120 s before each request, so the
  refresh claims nothing (spec 4.3, 4.5) and the feed answers from the database. The script
  re-primes before a run would pass 100 s.
- Requests run one at a time (no concurrency).

## What this doesn't tell

- Production adds the Supavisor pooler (port 6543, TLS) between Vercel and Postgres. Each feed
  request opens a few short transactions (instance, session, scope, query), so a pooler round trip
  of a few milliseconds each will add to these numbers; a Vercel cold start adds more on the first
  request to a new function instance.
- A cold refresh against real hubs and fediverse servers is bounded by the 6 s response budget
  (check 20), not by the database; the 403 ms first open above is replayed recordings only.
- The data set is small: 469 stored items (363 shown) across 16 spaces.

## Re-running

```bash
npx supabase db reset
npm run dev &               # .env as for npm run test:api (TEST_DID_LOOPBACK=1, :3005 trusted)
npx tsx scripts/perf-feed.ts
```
