// The secret scan for recorded fixtures (fediverse-posting-1 item 9.4, A5). The posting recorder
// runs it over everything it fetched before writing a single file, and the fixture-scan unit test
// runs it over every file in tests/fixtures/http/, so a credential can't reach the repo by either
// route.
//
// The spec names `access_token`, `client_secret` and `Bearer `. Mastodon's own discovery document
// lists `client_secret_basic` and `client_secret_post` as auth methods, so the two names are matched
// as JSON keys or form fields (`"client_secret":`, `client_secret=`), which is where a credential
// would sit; `Bearer ` is matched anywhere (DECISIONS, 2026-11-15).
import type { HttpFixture } from "../../src/shared/fetch/index.js";

const PATTERNS: Array<{ label: string; test: RegExp }> = [
  { label: "an access_token field", test: /"access_token"\s*:|[?&]access_token=|\baccess_token=/ },
  { label: "a client_secret field", test: /"client_secret"\s*:|\bclient_secret=/ },
  { label: "a Bearer credential", test: /Bearer\s/ },
];

/** What a fixture holds that looks like a credential; empty when it is clean. */
export function secretsIn(fixture: HttpFixture, token?: string): string[] {
  const found: string[] = [];
  const headerNames = Object.keys(fixture.requestHeaders ?? {}).map((h) => h.toLowerCase());
  // Only if-none-match is ever kept as a request header (spec 9.4).
  for (const name of headerNames) {
    if (name !== "if-none-match") found.push(`the request header "${name}"`);
  }
  const texts = [
    fixture.url,
    fixture.body,
    ...Object.entries(fixture.headers).map(([k, v]) => `${k}: ${v}`),
    ...Object.entries(fixture.requestHeaders ?? {}).map(([k, v]) => `${k}: ${v}`),
  ];
  for (const text of texts) {
    if (token && token.length > 0 && text.includes(token)) found.push("the token itself");
    for (const p of PATTERNS) if (p.test.test(text)) found.push(p.label);
  }
  return [...new Set(found)];
}
