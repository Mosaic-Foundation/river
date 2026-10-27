// Linking a fediverse account over HTTP (fediverse-posting-1.md item 1; checks 1 to 3), against
// the running dev server with TEST_STAND_IN_FEDIVERSE=1: every request to a member's server goes
// to the SYNTHETIC stand-in (tests/support/standInMastodon/), driven through its test routes.
// Members sign in through the River's real callback (helpers/member.ts). The database is read as
// the local stack's postgres to look at stored bytes, and to forget the instance's app
// registrations on the stand-in hosts before each test (the stand-in forgets its apps on reset).
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forAccount } from "../../../src/db/context.js";
import { API, DidLogServer, requireApi, type Member } from "../helpers/member.js";
import { standIn } from "../helpers/standInFediverse.js";
import { ADMIN_URL, RIVER_URL, SEED_INSTANCE, rolePool } from "./roles.js";

const logs = new DidLogServer();
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const river = rolePool(RIVER_URL);
let member: Member;

beforeAll(async () => {
  await requireApi();
  await logs.start();
  member = await logs.signIn();
});

afterAll(async () => {
  await logs.close();
  await admin.end();
  await river.end();
});

beforeEach(async () => {
  await standIn.reset();
  await admin.query("DELETE FROM river.oauth_clients WHERE host LIKE '%.stand-in.example'");
});

async function accountOf(who: Member): Promise<string> {
  const { rows } = await admin.query<{ account_id: string }>("SELECT account_id FROM river.login_methods WHERE did = $1", [who.did]);
  if (!rows[0]) throw new Error("no account for this DID");
  return rows[0].account_id;
}

function start(input: unknown, who: Member = member): Promise<Response> {
  return fetch(`${API}/linked-accounts/fediverse/start`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: who.origin, cookie: who.cookie },
    body: JSON.stringify({ input }),
  });
}

const MASTODON_SCOPES = "profile write:statuses write:favourites write:follows read:follows read:search";
const GTS_SCOPES = "read:accounts write:statuses write:favourites write:follows read:follows read:search";

function check(input: unknown, who: Member | null = member): Promise<Response> {
  return fetch(`${API}/linked-accounts/fediverse/check`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: member.origin, ...(who ? { cookie: who.cookie } : {}) },
    body: JSON.stringify({ input }),
  });
}

describe("POST /linked-accounts/fediverse/check", () => {
  it("finds a Mastodon 4.3 server and its limit, reading only public documents", async () => {
    const res = await check("@ana@mastodon.stand-in.example");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      handle: "@ana@mastodon.stand-in.example",
      server: "mastodon.stand-in.example",
      software: "Mastodon",
      maxCharacters: 500,
    });
    const requests = await standIn.requests();
    expect(requests.map((r) => `${r.method} ${r.path.split("?")[0]}`)).toEqual([
      "GET /.well-known/webfinger",
      "GET /.well-known/nodeinfo",
      "GET /nodeinfo/2.0",
      "GET /.well-known/oauth-authorization-server",
      "GET /api/v2/instance",
    ]);
    expect(requests.every((r) => r.headers.authorization === undefined && r.headers.cookie === undefined)).toBe(true);
  });

  it("finds GoToSocial with 5,000 characters, from a profile URL", async () => {
    const res = await check("https://gts.stand-in.example/@bob");
    expect(await res.json()).toMatchObject({ handle: "@bob@gts.stand-in.example", software: "GoToSocial", maxCharacters: 5000 });
  });

  it("refuses unsupported servers with their sentences, and registers nothing", async () => {
    const cases: Array<[string, number, string]> = [
      ["@ana@mastodon42.stand-in.example", 422, "The River can't post through this version of Mastodon yet."],
      ["@ana@nodiscovery.stand-in.example", 422, "The River can't post through this version of Mastodon yet."],
      ["@ana@akkoma.stand-in.example", 422, "The River can't post through Akkoma yet."],
      ["@nobody@mastodon.stand-in.example", 422, "mastodon.stand-in.example doesn't know @nobody@mastodon.stand-in.example. Check the handle."],
      ["ana@example.social", 400, "Type a handle like @ana@example.social, or the address of a profile page."],
    ];
    for (const [input, status, message] of cases) {
      const res = await check(input);
      expect(res.status, input).toBe(status);
      expect(((await res.json()) as { message: string }).message).toBe(message);
    }
    expect((await standIn.requests()).filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("says when the server is busy or can't be reached", async () => {
    await standIn.rules([{ host: "gts.stand-in.example", path: "/.well-known/nodeinfo", answer: 429 }]);
    const busy = await check("@ana@gts.stand-in.example");
    expect(busy.status).toBe(503);
    expect(((await busy.json()) as { message: string }).message).toBe("gts.stand-in.example is busy; try again in a few minutes.");
    await standIn.rules([{ path: "/", answer: "down" }]);
    const down = await check("@ana@mastodon.stand-in.example");
    expect(down.status).toBe(502);
  });

  it("is for members, with the River's Origin", async () => {
    expect((await check("@ana@mastodon.stand-in.example", null)).status).toBe(401);
    const noOrigin = await fetch(`${API}/linked-accounts/fediverse/check`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: member.cookie },
      body: JSON.stringify({ input: "@ana@mastodon.stand-in.example" }),
    });
    expect(noOrigin.status).toBe(403);
    expect(await standIn.requests()).toHaveLength(0);
  });
});

describe("POST /linked-accounts/fediverse/start", () => {
  it("registers once, stores a sealed attempt and answers the authorize URL with S256 and exactly the scopes (check 1)", async () => {
    const res = await start("@ana@mastodon.stand-in.example");
    expect(res.status).toBe(200);
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    const url = new URL(authorizeUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://mastodon.stand-in.example/oauth/authorize");
    const q = url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("scope")).toBe(MASTODON_SCOPES);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("redirect_uri")).toBe(`${member.origin}/api/auth/fediverse/callback`);

    // The state cookie: host-only, HttpOnly, 10 minutes, signed (the state, then a MAC).
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-river-link="));
    expect(cookie).toMatch(/^__Host-river-link=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
    expect(cookie?.split("=")[1]?.split(".")[0]).toBe(q.get("state"));

    // The registration: one, with the River's name, callback, scopes and website; redirects refused.
    const [app] = await standIn.apps();
    expect(app).toMatchObject({ host: "mastodon.stand-in.example", name: "Mosaic River", redirectUris: [q.get("redirect_uri")], website: member.origin });
    expect(app?.scopes.join(" ")).toBe(MASTODON_SCOPES);
    expect(q.get("client_id")).toBe(app?.clientId);

    // The stand-in's authorize page accepts it.
    expect((await standIn.authorize(authorizeUrl, "ana")).location).toMatch(/^http:\/\/localhost:\d+\/api\/auth\/fediverse\/callback\?code=/);

    // What is stored: the client secret and the PKCE verifier only as ciphertext.
    const secret = Buffer.from(app?.clientSecret ?? "-");
    const { rows: clients } = await admin.query<{ client_id: string; client_secret_ciphertext: Buffer; software: string; software_version: string }>(
      "SELECT * FROM river.oauth_clients WHERE instance_id = $1 AND host = 'mastodon.stand-in.example'",
      [SEED_INSTANCE],
    );
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ client_id: app?.clientId, software: "mastodon", software_version: "4.3.2" });
    const clientBytes = await admin.query<{ row: string }>("SELECT row_to_json(c)::text AS row FROM river.oauth_clients c WHERE host = 'mastodon.stand-in.example'");
    expect(clientBytes.rows[0]?.row.includes(app?.clientSecret ?? "-")).toBe(false);
    expect(clients[0]?.client_secret_ciphertext.includes(secret)).toBe(false);

    const accountId = await accountOf(member);
    const { rows: attempts } = await admin.query<{ purpose: string; server_host: string; requested: string; return_to: string; used_at: Date | null; verifier_ciphertext: Buffer }>(
      "SELECT * FROM river.acting_attempts WHERE account_id = $1 AND state = $2",
      [accountId, q.get("state")],
    );
    expect(attempts[0]).toMatchObject({
      purpose: "fediverse_link",
      server_host: "mastodon.stand-in.example",
      requested: "@ana@mastodon.stand-in.example",
      return_to: "/linked-accounts",
      used_at: null,
    });
    expect(attempts[0]?.verifier_ciphertext.length).toBeGreaterThan(43);

    // Redirects off for the registration (ADR-011 item 6, A2's rule for anything that returns a secret).
    const requests = await standIn.requests();
    expect(requests.filter((r) => r.method === "POST").map((r) => r.path)).toEqual(["/api/v1/apps"]);
  });

  it("a second member on the same server reuses the app (check 1)", async () => {
    expect((await start("@ana@mastodon.stand-in.example")).status).toBe(200);
    const other = await logs.signIn();
    const res = await start("@bob@mastodon.stand-in.example", other);
    expect(res.status).toBe(200);
    expect((await standIn.apps())).toHaveLength(1);
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    expect(new URL(authorizeUrl).searchParams.get("client_id")).toBe((await standIn.apps())[0]?.clientId);
  });

  it("GoToSocial is asked for read:accounts (check 3)", async () => {
    const res = await start("@bob@gts.stand-in.example");
    expect(res.status).toBe(200);
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    expect(new URL(authorizeUrl).searchParams.get("scope")).toBe(GTS_SCOPES);
    expect((await standIn.authorize(authorizeUrl, "bob")).location).toContain("code=");
  });

  it("refused servers register nothing (check 3)", async () => {
    for (const input of ["@ana@mastodon42.stand-in.example", "@ana@nodiscovery.stand-in.example", "@ana@akkoma.stand-in.example"]) {
      expect((await start(input)).status).toBe(422);
    }
    expect(await standIn.apps()).toHaveLength(0);
    const { rows } = await admin.query("SELECT 1 FROM river.oauth_clients WHERE host LIKE '%.stand-in.example'");
    expect(rows).toHaveLength(0);
  });

  // The rules' 429s carry no Retry-After: the dev server's guard would refuse that host for the
  // tests that follow.
  it("a busy server (429 on registration) says so, and a redirect on it is refused and reaches nothing", async () => {
    await standIn.rules([{ path: "/api/v1/apps", answer: 429 }]);
    const busy = await start("@ana@gts.stand-in.example");
    expect(busy.status).toBe(503);
    expect(((await busy.json()) as { message: string }).message).toBe("gts.stand-in.example is busy; try again in a few minutes.");

    await standIn.rules([{ path: "/api/v1/apps", answer: "redirect" }]);
    const redirected = await start("@ana@mastodon.stand-in.example");
    expect(redirected.status).toBe(502);
    expect((await standIn.requests()).filter((r) => r.host === "elsewhere.stand-in.example")).toHaveLength(0);
    const { rows } = await admin.query("SELECT 1 FROM river.oauth_clients WHERE host LIKE '%.stand-in.example'");
    expect(rows).toHaveLength(0);
  });

  it("re-registers when the stored app was made for another callback", async () => {
    expect((await start("@ana@mastodon.stand-in.example")).status).toBe(200);
    await admin.query("UPDATE river.oauth_clients SET redirect_uri = 'https://old.example/api/auth/fediverse/callback' WHERE host = 'mastodon.stand-in.example'");
    expect((await start("@ana@mastodon.stand-in.example")).status).toBe(200);
    expect(await standIn.apps()).toHaveLength(2);
    const { rows } = await admin.query<{ client_id: string }>("SELECT client_id FROM river.oauth_clients WHERE host = 'mastodon.stand-in.example'");
    expect(rows.map((r) => r.client_id)).toEqual([(await standIn.apps())[1]?.clientId]);
  });

  it("refuses a fourth account, but not linking one of the three again", async () => {
    const who = await logs.signIn();
    const accountId = await accountOf(who);
    await forAccount(
      SEED_INSTANCE,
      accountId,
      async (db) => {
        for (const name of ["one", "two", "ana"]) {
          await db.insert("linked_accounts", {
            id: randomUUID(),
            kind: "fediverse",
            server_host: "mastodon.stand-in.example",
            actor_uri: `https://mastodon.stand-in.example/users/${name}`,
            token_ciphertext: randomBytes(48),
            token_dek: randomBytes(60),
            token_key_version: 1,
          });
        }
      },
      river,
    );
    const refused = await start("@bob@gts.stand-in.example", who);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { message: string }).message).toBe(
      "You've linked 3 accounts, the most the River allows. Unlink one to link another.",
    );
    expect((await start("@ana@mastodon.stand-in.example", who)).status).toBe(200);
  });

  it("is for members, with the River's Origin", async () => {
    const visitor = await fetch(`${API}/linked-accounts/fediverse/start`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: member.origin },
      body: JSON.stringify({ input: "@ana@mastodon.stand-in.example" }),
    });
    expect(visitor.status).toBe(401);
    expect(visitor.headers.getSetCookie()).toEqual([]);
    expect(await standIn.requests()).toHaveLength(0);
  });
});

interface Callback {
  status: number;
  location: string;
  referrerPolicy: string | null;
  setCookies: string[];
}

/** Starts a link as `who`, approves on the stand-in as `username`, and follows the server's redirect to the River's callback. */
async function link(
  input: string,
  username: string,
  options: { who?: Member; deny?: boolean; cookie?: (linkCookie: string) => string | undefined } = {},
): Promise<Callback & { authorizeUrl: string; callbackUrl: string; linkCookie: string }> {
  const who = options.who ?? member;
  const started = await start(input, who);
  expect(started.status).toBe(200);
  const { authorizeUrl } = (await started.json()) as { authorizeUrl: string };
  const linkCookie = (started.headers.getSetCookie().find((c) => c.startsWith("__Host-river-link=")) ?? "").split(";")[0] ?? "";
  const approved = await standIn.authorize(authorizeUrl, username, options.deny);
  if (!approved.location) throw new Error(`stand-in refused: ${approved.error}`);
  const back = new URL(approved.location);
  const callbackUrl = `${API}/auth/fediverse/callback${back.search}`;
  const cookieHeader = options.cookie ? options.cookie(linkCookie) : linkCookie;
  const res = await callback(callbackUrl, who, cookieHeader);
  return { ...res, authorizeUrl, callbackUrl, linkCookie };
}

async function callback(url: string, who: Member | null, linkCookie: string | undefined): Promise<Callback> {
  const cookies = [who?.cookie, linkCookie].filter(Boolean).join("; ");
  const res = await fetch(url, { redirect: "manual", headers: cookies ? { cookie: cookies } : {} });
  return {
    status: res.status,
    location: res.headers.get("location") ?? "",
    referrerPolicy: res.headers.get("referrer-policy"),
    setCookies: res.headers.getSetCookie(),
  };
}

interface LinkedRow {
  id: string;
  kind: string;
  server_host: string;
  actor_uri: string;
  acct: string;
  remote_account_id: string;
  display_name: string;
  avatar_url: string;
  software: string;
  scopes: string;
  status: string;
  default_visibility: string | null;
  default_language: string | null;
  token_ciphertext: Buffer | null;
  linked_at: Date;
}

async function linkedRows(who: Member): Promise<LinkedRow[]> {
  const { rows } = await admin.query<LinkedRow>("SELECT * FROM river.linked_accounts WHERE account_id = $1 ORDER BY created_at", [await accountOf(who)]);
  return rows;
}

describe("GET /auth/fediverse/callback", () => {
  it("links a Mastodon account and stores the token only as ciphertext (check 1)", async () => {
    const who = await logs.signIn();
    const result = await link("@ana@mastodon.stand-in.example", "ana", { who });
    expect(result.status).toBe(303);
    expect(result.location).toBe("/linked-accounts?link=linked");
    expect(result.referrerPolicy).toBe("no-referrer");
    expect(result.setCookies).toContain("__Host-river-link=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");

    const rows = await linkedRows(who);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "fediverse",
      server_host: "mastodon.stand-in.example",
      actor_uri: "https://mastodon.stand-in.example/users/ana",
      acct: "ana@mastodon.stand-in.example",
      remote_account_id: "109000000000000001",
      display_name: "Ana (stand-in)",
      avatar_url: "https://mastodon.stand-in.example/avatars/ana.png",
      software: "mastodon",
      scopes: MASTODON_SCOPES,
      status: "active",
      default_visibility: "unlisted",
      default_language: "en",
    });

    const [token] = await standIn.tokens();
    expect(token).toBeDefined();
    const bytes = await admin.query<{ row: string }>("SELECT row_to_json(l)::text AS row FROM river.linked_accounts l WHERE id = $1", [rows[0]?.id]);
    expect(bytes.rows[0]?.row.includes(token ?? "-")).toBe(false);
    expect(rows[0]?.token_ciphertext?.includes(Buffer.from(token ?? "-"))).toBe(false);

    // The exchange sent the code, the verifier, the client secret and the exact redirect URI; the
    // account was read with the token. Nothing else carried it.
    const requests = await standIn.requests();
    const exchange = requests.find((r) => r.path === "/oauth/token");
    const form = new URLSearchParams(exchange?.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(form.get("redirect_uri")).toBe(`${member.origin}/api/auth/fediverse/callback`);
    expect(form.get("client_secret")).toBe((await standIn.apps())[0]?.clientSecret);
    const withToken = requests.filter((r) => r.headers.authorization !== undefined);
    expect(withToken.map((r) => r.path)).toEqual(["/api/v1/accounts/verify_credentials"]);
    expect(withToken[0]?.headers.authorization).toBe(`Bearer ${token}`);
  });

  it("links a GoToSocial account through WebFinger, with its own defaults (check 3)", async () => {
    const who = await logs.signIn();
    const result = await link("https://gts.stand-in.example/@bob", "bob", { who });
    expect(result.location).toBe("/linked-accounts?link=linked");
    const [row] = await linkedRows(who);
    expect(row).toMatchObject({
      actor_uri: "https://gts.stand-in.example/users/bob",
      acct: "bob@gts.stand-in.example",
      software: "gotosocial",
      scopes: GTS_SCOPES,
      display_name: "Bob <b>stand-in</b>",
      default_visibility: "public",
      default_language: null,
    });
  });

  it("refuses a missing or different state cookie without spending the attempt (check 2)", async () => {
    const who = await logs.signIn();
    const missing = await link("@ana@mastodon.stand-in.example", "ana", { who, cookie: () => undefined });
    expect(missing.location).toBe("/linked-accounts?link=expired");
    expect(missing.setCookies).toEqual([]);
    const forged = await callback(missing.callbackUrl, who, missing.linkCookie.replace(/=./, "=x"));
    expect(forged.location).toBe("/linked-accounts?link=expired");
    expect((await standIn.requests()).some((r) => r.path === "/oauth/token")).toBe(false);
    // The right cookie still works: nothing was spent.
    expect((await callback(missing.callbackUrl, who, missing.linkCookie)).location).toBe("/linked-accounts?link=linked");
    expect(await linkedRows(who)).toHaveLength(1);
  });

  it("refuses a used attempt, and another member's (check 2)", async () => {
    const who = await logs.signIn();
    const first = await link("@ana@mastodon.stand-in.example", "ana", { who });
    expect(first.location).toBe("/linked-accounts?link=linked");
    expect((await callback(first.callbackUrl, who, first.linkCookie)).location).toBe("/linked-accounts?link=expired");
    const thief = await logs.signIn();
    const second = await link("@bob@mastodon.stand-in.example", "bob", { who: thief, cookie: () => undefined });
    expect((await callback(second.callbackUrl, member, second.linkCookie)).location).toBe("/linked-accounts?link=expired");
    expect((await standIn.requests()).filter((r) => r.path === "/oauth/token")).toHaveLength(1);
  });

  it("refuses an account other than the one typed, and revokes its token (check 2)", async () => {
    const who = await logs.signIn();
    const result = await link("@ana@mastodon.stand-in.example", "bob", { who });
    expect(result.location).toBe("/linked-accounts?link=different_account");
    expect(await linkedRows(who)).toHaveLength(0);
    const [token] = await standIn.tokens();
    const revoke = (await standIn.requests()).find((r) => r.path === "/oauth/revoke");
    expect(new URLSearchParams(revoke?.body).get("token")).toBe(token);
  });

  it("a denial links nothing and exchanges nothing", async () => {
    const who = await logs.signIn();
    const result = await link("@ana@mastodon.stand-in.example", "ana", { who, deny: true });
    expect(result.location).toBe("/linked-accounts?link=denied");
    expect((await standIn.requests()).some((r) => r.path === "/oauth/token")).toBe(false);
    expect(await linkedRows(who)).toHaveLength(0);
  });

  it("a redirect on the token exchange or verify_credentials fails and reaches nothing (check 13)", async () => {
    const who = await logs.signIn();
    await standIn.rules([{ path: "/oauth/token", answer: "redirect" }]);
    expect((await link("@ana@mastodon.stand-in.example", "ana", { who })).location).toBe("/linked-accounts?link=failed");
    await standIn.rules([{ path: "/api/v1/accounts/verify_credentials", answer: "redirect" }]);
    expect((await link("@ana@mastodon.stand-in.example", "ana", { who })).location).toBe("/linked-accounts?link=failed");
    const requests = await standIn.requests();
    expect(requests.filter((r) => r.host === "elsewhere.stand-in.example")).toHaveLength(0);
    // The token it got was revoked, since nothing will hold it.
    expect(requests.filter((r) => r.path === "/oauth/revoke")).toHaveLength(1);
    expect(await linkedRows(who)).toHaveLength(0);
  });

  it("linking the same account again reuses its row", async () => {
    const who = await logs.signIn();
    await link("@ana@mastodon.stand-in.example", "ana", { who });
    const [before] = await linkedRows(who);
    await admin.query(
      "UPDATE river.linked_accounts SET status = 'unlinked', token_ciphertext = NULL, token_dek = NULL, token_key_version = NULL, revoked_at = now() WHERE id = $1",
      [before?.id],
    );
    expect((await link("@ana@mastodon.stand-in.example", "ana", { who })).location).toBe("/linked-accounts?link=linked");
    const after = await linkedRows(who);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before?.id, status: "active" });
  });

  it("a server that forgot the app is forgotten too", async () => {
    const who = await logs.signIn();
    const started = await start("@ana@mastodon.stand-in.example", who);
    const { authorizeUrl } = (await started.json()) as { authorizeUrl: string };
    const linkCookie = (started.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";
    const approved = await standIn.authorize(authorizeUrl, "ana");
    await standIn.rules([{ path: "/oauth/token", answer: 401, message: "invalid_client" }]);
    const res = await callback(`${API}/auth/fediverse/callback${new URL(approved.location ?? "").search}`, who, linkCookie);
    expect(res.location).toBe("/linked-accounts?link=failed");
    const { rows } = await admin.query("SELECT 1 FROM river.oauth_clients WHERE host = 'mastodon.stand-in.example'");
    expect(rows).toHaveLength(0);
  });

  it("a visitor is sent to the page without anything being spent", async () => {
    const result = await callback(`${API}/auth/fediverse/callback?state=x&code=y`, null, undefined);
    expect(result).toMatchObject({ status: 303, location: "/linked-accounts?link=signed_out", referrerPolicy: "no-referrer" });
  });
});
