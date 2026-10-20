# Recorded HTTP responses

Real responses from the seed hosts, keyed by their real `https://` URLs. API and e2e tests replay
them through `FETCH_FIXTURES_DIR=tests/fixtures/http`; unit tests load them into undici's
`MockAgent`. Re-record only when told to, with `npm run record-fixtures`. The file format is set
by the fetch guard's replay mode (M2) and the first recorder (M3).
