// The A5 posting recorder and the fixture scan (fediverse-posting-1.md item 9): the recorder runs
// against the SYNTHETIC stand-in server behind the real fetch guard, writes only GET answers with
// no Authorization header, and writes nothing when an answer holds the token; every recorded
// fixture in the repo passes the same scan.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env.js";
import { loadFixtures, type HttpFixture } from "../../src/shared/fetch/index.js";
import { fediversePostHandle, fediversePostRecorder, seedPostUri, SEED_ACTOR } from "../../scripts/recorders/fediversePost.js";
import { secretsIn } from "../../scripts/recorders/secretScan.js";
import { MASTODON_HOST, StandInFediverse } from "../support/standInMastodon/index.js";

const FIXTURES = "tests/fixtures/http";
const SCOPES = ["profile", "read:search", "read:follows"];

let standIn: StandInFediverse;
let out: string;

beforeEach(() => {
  standIn = new StandInFediverse();
  out = fs.mkdtempSync(path.join(os.tmpdir(), "a5-recorder-"));
});

afterEach(() => {
  fs.rmSync(out, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/** Ana's own public post, as item 9.1 asks the test account to have. */
function anaPosts(content = "<p>Hello from the test account.</p>"): void {
  standIn.statuses.set("200", {
    id: "200",
    host: MASTODON_HOST,
    uri: `https://${MASTODON_HOST}/users/ana/statuses/200`,
    url: `https://${MASTODON_HOST}/@ana/200`,
    account: "ana",
    content,
    spoilerText: "",
    visibility: "public",
    inReplyToId: null,
    language: "en",
    createdAt: Date.parse("2026-11-01T00:00:00Z"),
  });
}

function recorder(token: string) {
  return fediversePostRecorder(`@ana@${MASTODON_HOST}`, {
    guardOptions: standIn.guardOptions(),
    hosts: new Set([MASTODON_HOST]),
    token,
    seedFixturesDir: FIXTURES,
  });
}

describe("--fediverse-post", () => {
  it("takes only a mastodon.social handle", () => {
    expect(fediversePostHandle(["--fediverse-post", "@rivertest@mastodon.social"])).toBe("@rivertest@mastodon.social");
    expect(fediversePostHandle(["--fediverse-post", "rivertest@mastodon.social"])).toBe("@rivertest@mastodon.social");
    expect(fediversePostHandle(["--bluesky"])).toBeUndefined();
    expect(() => fediversePostHandle(["--fediverse-post"])).toThrow(/Usage/);
    expect(() => fediversePostHandle(["--fediverse-post", "@ana@example.social"])).toThrow(/Usage/);
  });

  it("the seed post is an original w3c post from the recorded outbox", () => {
    expect(seedPostUri(FIXTURES)).toMatch(new RegExp(`^${SEED_ACTOR}/statuses/\\d+$`));
  });

  it("records the linking and acting GETs, with no Authorization header and nothing sent but GETs", async () => {
    anaPosts();
    const token = standIn.issueToken(MASTODON_HOST, "ana", SCOPES);
    const written = await recorder(token).record(out);

    const fixtures = loadFixtures(out);
    expect(written).toHaveLength(fixtures.length);
    const paths = fixtures.map((f) => new URL(f.url).pathname).sort();
    expect(paths).toEqual(
      [
        "/.well-known/nodeinfo",
        "/.well-known/oauth-authorization-server",
        "/.well-known/webfinger",
        "/api/v1/accounts/109000000000000001/statuses",
        "/api/v1/accounts/relationships",
        "/api/v1/accounts/verify_credentials",
        "/api/v2/instance",
        "/api/v2/search",
        "/api/v2/search",
        "/api/v2/search",
        "/nodeinfo/2.0",
      ].sort(),
    );
    for (const f of fixtures) {
      expect(f.method ?? "GET").toBe("GET");
      expect(f.requestHeaders).toBeUndefined();
      expect(f.status).toBe(200);
      expect(secretsIn(f, token)).toEqual([]);
    }
    const searches = fixtures.filter((f) => f.url.includes("/api/v2/search")).map((f) => new URL(f.url).searchParams);
    expect(searches.map((q) => q.get("q")).sort()).toEqual(
      [`https://${MASTODON_HOST}/users/ana/statuses/200`, seedPostUri(FIXTURES), SEED_ACTOR].sort(),
    );
    expect(standIn.requests.every((r) => r.method === "GET")).toBe(true);
    // The token went only to the calls that need it.
    const withToken = standIn.requests.filter((r) => r.headers.authorization === `Bearer ${token}`).map((r) => r.path.split("?")[0]);
    expect(new Set(withToken)).toEqual(new Set(["/api/v1/accounts/verify_credentials", "/api/v2/search", "/api/v1/accounts/relationships"]));
  });

  it("writes nothing when an answer holds the token", async () => {
    const token = standIn.issueToken(MASTODON_HOST, "ana", SCOPES);
    anaPosts(`<p>oops ${token}</p>`);
    await expect(recorder(token).record(out)).rejects.toThrow(/Nothing was written[\s\S]*the token itself/);
    expect(loadFixtures(out)).toEqual([]);
  });

  it("stops before writing when the account has no post of its own", async () => {
    const token = standIn.issueToken(MASTODON_HOST, "ana", SCOPES);
    await expect(recorder(token).record(out)).rejects.toThrow(/no post of its own/);
    expect(loadFixtures(out)).toEqual([]);
  });

  it("refuses RECORD_MASTODON_TOKEN under CI or on Vercel", () => {
    vi.stubEnv("RECORD_MASTODON_TOKEN", "x");
    vi.stubEnv("CI", "");
    vi.stubEnv("VERCEL", "");
    expect(env.recordMastodonToken).toBe("x");
    vi.stubEnv("CI", "true");
    expect(() => env.recordMastodonToken).toThrow(/must not be set in CI or on Vercel/);
    vi.stubEnv("CI", "");
    vi.stubEnv("VERCEL", "1");
    expect(() => env.recordMastodonToken).toThrow(/must not be set in CI or on Vercel/);
  });
});

describe("the fixture scan", () => {
  const base: HttpFixture = { url: "https://example.social/api/v2/instance", status: 200, headers: {}, body: "{}" };

  it("finds credentials and request headers other than if-none-match", () => {
    expect(secretsIn({ ...base, body: '{"access_token": "abc"}' })).toContain("an access_token field");
    expect(secretsIn({ ...base, body: "grant_type=x&client_secret=abc" })).toContain("a client_secret field");
    expect(secretsIn({ ...base, body: '{"client_secret":"abc"}' })).toContain("a client_secret field");
    expect(secretsIn({ ...base, headers: { "x-echo": "Bearer abc" } })).toContain("a Bearer credential");
    expect(secretsIn({ ...base, body: "the token is s3cr3t-value" }, "s3cr3t-value")).toContain("the token itself");
    expect(secretsIn({ ...base, requestHeaders: { authorization: "x" } })).toContain('the request header "authorization"');
    expect(secretsIn({ ...base, requestHeaders: { "if-none-match": '"etag"' } })).toEqual([]);
  });

  it("lets Mastodon's discovery document through (its auth method names aren't credentials)", () => {
    const body = JSON.stringify({ token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"], grant_types_supported: ["authorization_code"] });
    expect(secretsIn({ ...base, body })).toEqual([]);
  });

  it("every recorded fixture in the repo is clean", () => {
    const fixtures = loadFixtures(FIXTURES);
    expect(fixtures.length).toBeGreaterThan(50);
    const dirty = fixtures.flatMap((f) => secretsIn(f).map((p) => `${f.url}: ${p}`));
    expect(dirty).toEqual([]);
  });
});
