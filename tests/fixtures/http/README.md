# Recorded HTTP responses

Real responses from the seed hosts, keyed by their real `https://` URLs. Re-record only when told
to, with `npm run record-fixtures`. Tests never call outside hosts.

## Format (set by the fetch guard, `src/shared/fetch/fixtures.ts`)

One JSON file per request, at `<host>/<slug>-<hash>.json`:

```json
{
  "url": "https://demosville.civic.social/…",
  "method": "GET",
  "requestHeaders": { "if-none-match": "\"v1\"" },
  "status": 200,
  "headers": { "content-type": "application/json", "etag": "\"v1\"" },
  "body": "…"
}
```

`method` is left out for GET. `requestHeaders` is optional: a fixture that has it answers only
requests that carry those headers, so a 304 for `If-None-Match` can sit next to the 200. Recorders
write files with `saveFixture(dir, await fixtureFromResponse(response, request))`, which drops
cookies and connection headers.

## Replay

- **API and e2e tests:** `FETCH_FIXTURES_DIR=tests/fixtures/http` makes `getFetchGuard()` replay
  these files through the real guard. URL and address checks still run; a recorded host resolves
  to a stand-in public address that is never connected to. An unrecorded host fails as
  `unresolvable_host`; an unrecorded path on a recorded host fails as `no_fixture`. The app refuses
  to start with this variable on Vercel.
- **Unit tests:** build a guard with
  `createFetchGuard({ dispatcher: mockAgentFromFixtures(fixtures), resolver: fixtureResolver(fixtures) })`,
  or `replayOptions(dir)`, and pass it to the code under test.
