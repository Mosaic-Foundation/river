// The stand-in fediverse server (fediverse-posting-1.md item 9; tests/support/standInMastodon/):
// SYNTHETIC answers written from Mastodon's documentation. Its discovery answers per host, app
// registration, the authorize step with PKCE S256, the token exchange, verify_credentials with
// scopes, revocation, the rules, and reaching it through the River's real fetch guard (where a
// credential-carrying request refuses its redirect and nothing reaches the target).
import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createFetchGuard, FetchError } from "../../src/shared/fetch/index.js";
import {
  AKKOMA_HOST,
  ELSEWHERE_HOST,
  GTS_HOST,
  MASTODON_HOST,
  NO_DISCOVERY_HOST,
  OLD_MASTODON_HOST,
  StandInFediverse,
  type StandInRequest,
} from "../support/standInMastodon/index.js";

const REDIRECT = "https://river.test.example/api/auth/fediverse/callback";
const MASTODON_SCOPES = "profile write:statuses write:favourites write:follows read:follows read:search";
const GTS_SCOPES = "read:accounts write:statuses write:favourites write:follows read:follows read:search";

let server: StandInFediverse;

beforeEach(() => {
  server = new StandInFediverse();
});

function get(host: string, path: string, headers: Record<string, string> = {}): ReturnType<StandInFediverse["handle"]> {
  return server.handle({ host, method: "GET", path, headers, body: "" });
}

function post(host: string, path: string, form: Record<string, string | string[]>, headers: Record<string, string> = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(form)) for (const v of [value].flat()) params.append(name, v);
  const request: StandInRequest = {
    host,
    method: "POST",
    path,
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: params.toString(),
  };
  return server.handle(request);
}

function body(answer: { body: string }): Record<string, unknown> {
  return JSON.parse(answer.body) as Record<string, unknown>;
}

function register(host: string, scopes: string): { clientId: string; clientSecret: string } {
  const answer = post(host, "/api/v1/apps", { client_name: "Mosaic River", "redirect_uris[]": REDIRECT, scopes, website: "https://river.test.example" });
  expect(answer.status).toBe(200);
  const b = body(answer);
  return { clientId: b.client_id as string, clientSecret: b.client_secret as string };
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeUrl(host: string, clientId: string, scopes: string, challenge: string, state = "s".repeat(43)): string {
  const url = new URL(`https://${host}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** Registers, authorizes as `username` and exchanges the code; returns the token. */
function link(host: string, scopes: string, username = "ana"): { token: string; app: { clientId: string; clientSecret: string } } {
  const app = register(host, scopes);
  const { verifier, challenge } = pkce();
  const result = server.authorize(authorizeUrl(host, app.clientId, scopes, challenge), username);
  if (!("location" in result)) throw new Error(result.error);
  const code = new URL(result.location).searchParams.get("code") ?? "";
  const answer = post(host, "/oauth/token", {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: app.clientId,
    client_secret: app.clientSecret,
    code_verifier: verifier,
  });
  expect(answer.status).toBe(200);
  return { token: body(answer).access_token as string, app };
}

describe("discovery", () => {
  it("serves WebFinger, NodeInfo, the discovery document and the instance for Mastodon 4.3", () => {
    const wf = body(get(MASTODON_HOST, `/.well-known/webfinger?resource=acct:ana@${MASTODON_HOST}`));
    expect(wf.links).toContainEqual({ rel: "self", type: "application/activity+json", href: `https://${MASTODON_HOST}/users/ana` });
    const links = body(get(MASTODON_HOST, "/.well-known/nodeinfo")).links as Array<{ href: string }>;
    expect(links[0]?.href).toBe(`https://${MASTODON_HOST}/nodeinfo/2.0`);
    expect(body(get(MASTODON_HOST, "/nodeinfo/2.0")).software).toEqual({ name: "mastodon", version: "4.3.2" });
    expect(body(get(MASTODON_HOST, "/.well-known/oauth-authorization-server")).code_challenge_methods_supported).toEqual(["S256"]);
    const statuses = (body(get(MASTODON_HOST, "/api/v2/instance")).configuration as { statuses: Record<string, number> }).statuses;
    expect(statuses.max_characters).toBe(500);
    expect(statuses.characters_reserved_per_url).toBe(23);
  });

  it("GoToSocial has no discovery document and 5,000 characters", () => {
    expect(body(get(GTS_HOST, "/nodeinfo/2.0")).software).toEqual({ name: "gotosocial", version: "0.19.1 git-2b3c4d5" });
    expect(get(GTS_HOST, "/.well-known/oauth-authorization-server").status).toBe(404);
    const config = body(get(GTS_HOST, "/api/v2/instance")).configuration as { statuses: Record<string, number> };
    expect(config.statuses.max_characters).toBe(5000);
  });

  it("names the old Mastodon, the one without discovery and Akkoma", () => {
    expect(body(get(OLD_MASTODON_HOST, "/nodeinfo/2.0")).software).toEqual({ name: "mastodon", version: "4.2.10" });
    expect(get(NO_DISCOVERY_HOST, "/.well-known/oauth-authorization-server").status).toBe(404);
    expect(body(get(NO_DISCOVERY_HOST, "/nodeinfo/2.0")).software).toEqual({ name: "mastodon", version: "4.4.0" });
    expect((body(get(AKKOMA_HOST, "/nodeinfo/2.0")).software as { name: string }).name).toBe("akkoma");
  });

  it("answers 404 for unknown accounts and for another host's handle", () => {
    expect(get(MASTODON_HOST, `/.well-known/webfinger?resource=acct:nobody@${MASTODON_HOST}`).status).toBe(404);
    expect(get(MASTODON_HOST, `/.well-known/webfinger?resource=acct:ana@${GTS_HOST}`).status).toBe(404);
  });
});

describe("app registration", () => {
  it("registers with the form's redirect URI and scopes, and records the request", () => {
    const app = register(MASTODON_HOST, MASTODON_SCOPES);
    const stored = server.apps.get(app.clientId);
    expect(stored?.redirectUris).toEqual([REDIRECT]);
    expect(stored?.scopes.join(" ")).toBe(MASTODON_SCOPES);
    expect(server.requestsTo(MASTODON_HOST, "/api/v1/apps")).toHaveLength(1);
  });

  it("takes a JSON body too", () => {
    const answer = server.handle({
      host: MASTODON_HOST,
      method: "POST",
      path: "/api/v1/apps",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Mosaic River", redirect_uris: [REDIRECT], scopes: "profile" }),
    });
    expect(answer.status).toBe(200);
  });

  it("GoToSocial refuses `profile`; Mastodon 4.2 doesn't know it either", () => {
    expect(post(GTS_HOST, "/api/v1/apps", { client_name: "Mosaic River", "redirect_uris[]": REDIRECT, scopes: MASTODON_SCOPES }).status).toBe(422);
    expect(post(OLD_MASTODON_HOST, "/api/v1/apps", { client_name: "Mosaic River", "redirect_uris[]": REDIRECT, scopes: "profile" }).status).toBe(422);
    expect(post(GTS_HOST, "/api/v1/apps", { client_name: "Mosaic River", "redirect_uris[]": REDIRECT, scopes: GTS_SCOPES }).status).toBe(200);
  });
});

describe("authorization", () => {
  it("links with PKCE S256 and the token reads verify_credentials with source", () => {
    const { token } = link(MASTODON_HOST, MASTODON_SCOPES);
    const answer = get(MASTODON_HOST, "/api/v1/accounts/verify_credentials", { Authorization: `Bearer ${token}` });
    expect(answer.status).toBe(200);
    const account = body(answer);
    expect(account).toMatchObject({ acct: "ana", url: `https://${MASTODON_HOST}/@ana`, uri: `https://${MASTODON_HOST}/users/ana` });
    expect(account.source).toMatchObject({ privacy: "unlisted", language: "en" });
  });

  it("GoToSocial accounts have no uri and read:accounts is enough", () => {
    const { token } = link(GTS_HOST, GTS_SCOPES, "bob");
    const account = body(get(GTS_HOST, "/api/v1/accounts/verify_credentials", { authorization: `Bearer ${token}` }));
    expect(account.acct).toBe("bob");
    expect(account.uri).toBeUndefined();
  });

  it("refuses an authorize URL without S256, with another redirect or with scopes beyond the app's", () => {
    const app = register(MASTODON_HOST, "profile write:statuses");
    const { challenge } = pkce();
    const good = authorizeUrl(MASTODON_HOST, app.clientId, "profile", challenge);
    expect("location" in server.authorize(good, "ana")).toBe(true);
    const plain = new URL(good);
    plain.searchParams.set("code_challenge_method", "plain");
    expect(server.authorize(plain.toString(), "ana")).toEqual({ error: "PKCE S256 required" });
    const other = new URL(good);
    other.searchParams.set("redirect_uri", "https://evil.example/cb");
    expect(server.authorize(other.toString(), "ana")).toEqual({ error: "redirect_uri not registered" });
    expect(server.authorize(authorizeUrl(MASTODON_HOST, app.clientId, "profile write:follows", challenge), "ana")).toEqual({
      error: "scope outside the app's scopes",
    });
  });

  it("a denial comes back as access_denied with the state", () => {
    const app = register(MASTODON_HOST, "profile");
    const result = server.authorize(authorizeUrl(MASTODON_HOST, app.clientId, "profile", pkce().challenge, "the-state"), "ana", { deny: true });
    if (!("location" in result)) throw new Error(result.error);
    const back = new URL(result.location);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("the-state");
    expect(back.searchParams.has("code")).toBe(false);
  });

  it("refuses a wrong verifier, a used code, and a wrong client secret", () => {
    const app = register(MASTODON_HOST, "profile");
    const { verifier, challenge } = pkce();
    const result = server.authorize(authorizeUrl(MASTODON_HOST, app.clientId, "profile", challenge), "ana");
    if (!("location" in result)) throw new Error(result.error);
    const code = new URL(result.location).searchParams.get("code") ?? "";
    const form = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: app.clientId, client_secret: app.clientSecret };
    expect(post(MASTODON_HOST, "/oauth/token", { ...form, client_secret: "wrong" }).status).toBe(401);
    expect(post(MASTODON_HOST, "/oauth/token", { ...form, code_verifier: pkce().verifier }).status).toBe(400);
    expect(post(MASTODON_HOST, "/oauth/token", { ...form, code_verifier: verifier }).status).toBe(200);
    expect(post(MASTODON_HOST, "/oauth/token", { ...form, code_verifier: verifier }).status).toBe(400);
  });

  it("answers 403 for a token without the identity scope and 401 once revoked", () => {
    const { token, app } = link(MASTODON_HOST, "write:statuses");
    const auth = { authorization: `Bearer ${token}` };
    expect(get(MASTODON_HOST, "/api/v1/accounts/verify_credentials", auth).status).toBe(403);
    expect(post(MASTODON_HOST, "/oauth/revoke", { client_id: app.clientId, client_secret: app.clientSecret, token }).status).toBe(200);
    expect(server.tokens.get(token)?.revoked).toBe(true);
    expect(get(MASTODON_HOST, "/api/v1/accounts/verify_credentials", auth).status).toBe(401);
  });

  it("revokeAll() revokes every token", () => {
    const { token } = link(MASTODON_HOST, MASTODON_SCOPES);
    server.revokeAll();
    expect(get(MASTODON_HOST, "/api/v1/accounts/verify_credentials", { authorization: `Bearer ${token}` }).status).toBe(401);
  });
});

describe("rules", () => {
  it("override answers by host, method and path, with Retry-After and a message", () => {
    server.rules.push({ host: MASTODON_HOST, path: "/api/v1/apps", answer: 429, retryAfter: 120 });
    server.rules.push({ path: "/api/v2/instance", method: "GET", answer: 422, message: "<b>nope</b>" });
    const limited = post(MASTODON_HOST, "/api/v1/apps", { client_name: "x", "redirect_uris[]": REDIRECT });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("120");
    expect(post(GTS_HOST, "/api/v1/apps", { client_name: "x", "redirect_uris[]": REDIRECT, scopes: "read" }).status).toBe(200);
    expect(body(get(GTS_HOST, "/api/v2/instance"))).toEqual({ error: "<b>nope</b>" });
  });
});

describe("behind the fetch guard", () => {
  function guard() {
    return createFetchGuard(server.guardOptions());
  }

  it("answers through the guard and records headers and form bodies", async () => {
    const res = await guard().fetch(`https://${MASTODON_HOST}/api/v1/apps`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_name: "Mosaic River", "redirect_uris[]": REDIRECT, scopes: MASTODON_SCOPES }).toString(),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { client_id: string }).client_id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [recorded] = server.requestsTo(MASTODON_HOST);
    expect(recorded?.headers["user-agent"]).toMatch(/^MosaicRiver\//);
    expect(new URLSearchParams(recorded?.body).get("client_name")).toBe("Mosaic River");
  });

  it("a credential-carrying request refuses the redirect rule and nothing reaches elsewhere", async () => {
    server.rules.push({ path: "/oauth/token", answer: "redirect" });
    await expect(
      guard().fetch(`https://${MASTODON_HOST}/oauth/token`, { method: "POST", body: "client_secret=s", redirect: "error" }),
    ).rejects.toMatchObject({ code: "redirect_refused" });
    expect(server.requestsTo(ELSEWHERE_HOST)).toHaveLength(0);
    // Without redirect: "error" the guard would follow it (the stand-in's target counts it).
    await guard().fetch(`https://${MASTODON_HOST}/oauth/token`, { method: "POST", body: "x=1" });
    expect(server.requestsTo(ELSEWHERE_HOST)).toHaveLength(1);
  });

  it("a down rule drops the connection", async () => {
    server.rules.push({ host: GTS_HOST, path: "/oauth/revoke", answer: "down" });
    const err = await guard()
      .fetch(`https://${GTS_HOST}/oauth/revoke`, { method: "POST", body: "token=t" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).code).toBe("network");
    expect((await guard().fetch(`https://${GTS_HOST}/api/v2/instance`)).status).toBe(200);
  });

  it("other hosts don't resolve without a fallback", async () => {
    await expect(guard().fetch("https://mastodon.social/api/v2/instance")).rejects.toMatchObject({ code: "unresolvable_host" });
  });
});
