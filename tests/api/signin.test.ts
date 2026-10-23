// The River's sign-in over HTTP (spec 4.6, Appendix B; check 11, and the API side of 10 and 23),
// against the running dev server (`npm run dev`, reading .env). Notes are signed here with test
// keys; their DID logs (built with didwebvh-ts, as the identity host builds them) are served by a
// small loopback server this file starts on :3005, which .env lists in TRUSTED_DID_HOSTS, and
// which the River reads in test mode (TEST_DID_LOOPBACK=1). A second server on :3006 is NOT
// trusted and must never be asked anything.
//
// Every refusal must be a 401 with no session cookie and no account made.
import { createPublicKey, generateKeyPairSync, randomBytes, sign as edSign, type KeyObject } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createDID, MultibaseEncoding, multibaseEncode, prepareDataForSigning, type Signer } from "didwebvh-ts";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL } from "./db/roles.js";

const API = process.env.API_URL ?? "http://localhost:3000";
const TRUSTED_PORT = 3005;
const UNTRUSTED_PORT = 3006;
const SESSION = "__Host-river-session";
const STATE = "__Host-river-signin";

interface Key {
  privateKey: KeyObject;
  multikey: string;
}

function newKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url");
  return { privateKey, multikey: multibaseEncode(new Uint8Array([0xed, 0x01, ...raw]), MultibaseEncoding.BASE58_BTC) };
}

interface TestDid {
  did: string;
  scid: string;
  key: Key;
  code: string;
}

/** A did:webvh like the identity host's: one Ed25519 key, the update key and #key-1. */
async function testDid(port: number): Promise<{ did: TestDid; jsonl: string }> {
  const key = newKey();
  const code = randomBytes(5).toString("hex").slice(0, 8);
  const host = `localhost%3A${port}`;
  const id = `did:webvh:{SCID}:${host}:u:${code}`;
  const signer: Signer = {
    getVerificationMethodId: () => `did:key:${key.multikey}#${key.multikey}`,
    async sign({ document, proof }) {
      const data = await prepareDataForSigning(document, proof);
      return { proofValue: multibaseEncode(new Uint8Array(edSign(null, data, key.privateKey)), MultibaseEncoding.BASE58_BTC) };
    },
  };
  const result = await createDID({
    address: `localhost:${port}`,
    paths: ["u", code],
    signer,
    verifier: {
      async verify() {
        return true;
      },
    },
    updateKeys: [key.multikey],
    didDocument: {
      "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
      id,
      controller: id,
      verificationMethod: [{ id: `${id}#key-1`, type: "Multikey", controller: id, publicKeyMultibase: key.multikey }],
      authentication: [`${id}#key-1`],
    },
    portable: true,
    witness: null,
    watchers: null,
    created: `${new Date(Date.now() - 60_000).toISOString().slice(0, 19)}Z`,
  });
  return {
    did: { did: result.did, scid: result.meta.scid, key, code },
    jsonl: result.log.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
  };
}

class LogServer {
  readonly logs = new Map<string, string>();
  readonly requests: string[] = [];
  private server?: http.Server;
  async start(port: number): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.requests.push(req.url ?? "");
      const body = this.logs.get(req.url ?? "");
      if (body === undefined) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/jsonl" }).end(body);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, () => resolve());
    });
    void (this.server.address() as AddressInfo);
  }
  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

const trustedServer = new LogServer();
const untrustedServer = new LogServer();
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
let alice: TestDid;
let bob: TestDid;
let mallory: TestDid;
/** The River's own origin (RIVER_PUBLIC_ORIGIN): the note's aud, and the Origin it accepts. */
let origin: string;

beforeAll(async () => {
  try {
    await fetch(`${API}/health`);
  } catch {
    throw new Error(`No API at ${API}. Start it with \`npm run dev\` (see tests/api/README.md).`);
  }
  await trustedServer.start(TRUSTED_PORT);
  await untrustedServer.start(UNTRUSTED_PORT);
  for (const [server, port, assign] of [
    [trustedServer, TRUSTED_PORT, (d: TestDid) => (alice = d)],
    [trustedServer, TRUSTED_PORT, (d: TestDid) => (bob = d)],
    [untrustedServer, UNTRUSTED_PORT, (d: TestDid) => (mallory = d)],
  ] as const) {
    const { did, jsonl } = await testDid(port);
    server.logs.set(`/u/${did.code}/did.jsonl`, jsonl);
    assign(did);
  }
  origin = new URL((await start()).clientId).origin;
}, 30_000);

afterAll(async () => {
  await trustedServer.stop();
  await untrustedServer.stop();
  await admin.end();
});

interface Started {
  state: string;
  nonce: string;
  clientId: string;
  redirectUri: string;
  /** The signed state cookie, as `name=value`. */
  cookie: string;
  setCookie: string;
  location: string;
}

/** GET /auth/signin, as the River's Sign up and Sign in buttons do. */
async function start(): Promise<Started> {
  const res = await fetch(`${API}/auth/signin`, { redirect: "manual" });
  expect(res.status).toBe(303);
  const location = res.headers.get("location") ?? "";
  const url = new URL(location);
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${STATE}=`)) ?? "";
  return {
    state: url.searchParams.get("state") ?? "",
    nonce: url.searchParams.get("nonce") ?? "",
    clientId: url.searchParams.get("client_id") ?? "",
    redirectUri: url.searchParams.get("redirect_uri") ?? "",
    cookie: setCookie.split(";")[0] ?? "",
    setCookie,
    location,
  };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function note(
  who: TestDid,
  nonce: string,
  change: { header?: Record<string, unknown>; payload?: Record<string, unknown>; signer?: KeyObject } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", kid: `${who.did}#key-1`, ...change.header };
  const payload = { iss: who.did, sub: who.did, aud: origin, nonce, iat: now, exp: now + 120, ...change.payload };
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${edSign(null, Buffer.from(input, "ascii"), change.signer ?? who.key.privateKey).toString("base64url")}`;
}

interface CallbackResult {
  status: number;
  location: string | null;
  cookies: string[];
  referrerPolicy: string | null;
  body: string;
}

async function callback(state: string, jws: string, cookie: string | undefined): Promise<CallbackResult> {
  const url = `${API}/auth/callback?${new URLSearchParams({ state, note: jws })}`;
  const res = await fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return {
    status: res.status,
    location: res.headers.get("location"),
    cookies: res.headers.getSetCookie(),
    referrerPolicy: res.headers.get("referrer-policy"),
    body: await res.text(),
  };
}

function sessionFrom(result: CallbackResult): string | undefined {
  const set = result.cookies.find((c) => c.startsWith(`${SESSION}=`) && !c.startsWith(`${SESSION}=;`));
  return set?.split(";")[0];
}

async function accountsFor(scid: string): Promise<number> {
  const { rows } = await admin.query("SELECT count(*)::int AS n FROM river.login_methods WHERE scid = $1", [scid]);
  return rows[0].n as number;
}

function expectRefused(result: CallbackResult): void {
  expect(result.status).toBe(401);
  expect(sessionFrom(result)).toBeUndefined();
  expect(result.location).toBeNull();
  expect(result.body).toContain("Sign-in didn't work");
  expect(result.referrerPolicy).toBe("no-referrer");
}

describe("starting a sign-in (spec 4.6 step 1)", () => {
  it("stores an attempt, sets a 10-minute state cookie and redirects to the identity host", async () => {
    const s = await start();
    expect(s.location.startsWith(`${new URL(s.location).origin}/authorize?`)).toBe(true);
    expect(s.clientId).toBe(origin);
    expect(s.redirectUri).toBe(`${origin}/api/auth/callback`);
    expect(s.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.state).not.toBe(s.nonce);
    expect(s.setCookie).toMatch(/; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
    // The cookie holds the state, signed.
    expect(s.cookie.startsWith(`${STATE}=${s.state}.`)).toBe(true);
    const { rows } = await admin.query("SELECT nonce, used_at FROM river.auth_attempts WHERE state = $1", [s.state]);
    expect(rows).toEqual([{ nonce: s.nonce, used_at: null }]);
  });
});

describe("the callback accepts a good note (check 10, API side)", () => {
  it("sets a 30-day session, sends no-referrer, redirects to / and makes one account", async () => {
    const s = await start();
    const result = await callback(s.state, note(alice, s.nonce), s.cookie);
    expect(result.status).toBe(303);
    expect(result.location).toBe("/");
    expect(result.referrerPolicy).toBe("no-referrer");
    const set = result.cookies.find((c) => c.startsWith(`${SESSION}=`)) ?? "";
    expect(set).toMatch(/; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
    expect(result.cookies.some((c) => c.startsWith(`${STATE}=;`))).toBe(true);
    expect(await accountsFor(alice.scid)).toBe(1);

    // The session works: the feed answers as the member.
    const feed = await fetch(`${API}/feed`, { headers: { cookie: sessionFrom(result) ?? "" } });
    const body = (await feed.json()) as { viewer: { did: string } | null };
    expect(body.viewer?.did).toBe(alice.did);

    // The attempt is spent: the same state and note again are refused.
    expectRefused(await callback(s.state, note(alice, s.nonce), s.cookie));
  });
});

describe("check 11: the callback refuses, with 401 and no session", () => {
  const now = () => Math.floor(Date.now() / 1000);
  const cases: Array<[string, (s: Started) => string]> = [
    ["wrong aud", (s) => note(bob, s.nonce, { payload: { aud: "https://other.example" } })],
    ["expired exp", (s) => note(bob, s.nonce, { payload: { iat: now() - 300, exp: now() - 180 } })],
    ["iat in the future", (s) => note(bob, s.nonce, { payload: { iat: now() + 300, exp: now() + 420 } })],
    ["mismatched nonce", () => note(bob, randomBytes(32).toString("base64url"))],
    ["a signature by a different key", (s) => note(bob, s.nonce, { signer: newKey().privateKey })],
    ["a kid naming another DID", (s) => note(bob, s.nonce, { header: { kid: `${alice.did}#key-1` } })],
    ["alg other than EdDSA (ES256)", (s) => note(bob, s.nonce, { header: { alg: "ES256" } })],
    ["alg none", (s) => note(bob, s.nonce, { header: { alg: "none" } })],
  ];

  it.each(cases)("%s", async (_label, make) => {
    const s = await start();
    expectRefused(await callback(s.state, make(s), s.cookie));
    expect(await accountsFor(bob.scid)).toBe(0);
    // The attempt was consumed: even a good note can't use it now.
    expectRefused(await callback(s.state, note(bob, s.nonce), s.cookie));
    expect(await accountsFor(bob.scid)).toBe(0);
  });

  it("a DID on a host not in TRUSTED_DID_HOSTS, without asking that host anything", async () => {
    const s = await start();
    expectRefused(await callback(s.state, note(mallory, s.nonce), s.cookie));
    expect(untrustedServer.requests).toEqual([]);
    expect(await accountsFor(mallory.scid)).toBe(0);
  });

  it("an unknown state", async () => {
    const s = await start();
    const unknown = randomBytes(32).toString("base64url");
    // A cookie for the unknown state can't be forged without SESSION_SECRET; the real one doesn't match.
    expectRefused(await callback(unknown, note(bob, s.nonce), s.cookie));
  });

  it("an already-used state", async () => {
    const s = await start();
    const first = await callback(s.state, note(bob, s.nonce), s.cookie);
    expect(first.status).toBe(303);
    expectRefused(await callback(s.state, note(bob, s.nonce), s.cookie));
    expect(await accountsFor(bob.scid)).toBe(1);
  });

  it("a missing or different state cookie, which leaves the attempt for the right browser", async () => {
    const s = await start();
    const other = await start();
    expectRefused(await callback(s.state, note(alice, s.nonce), undefined));
    expectRefused(await callback(s.state, note(alice, s.nonce), other.cookie));
    // A cookie with the right state but no valid signature.
    expectRefused(await callback(s.state, note(alice, s.nonce), `${STATE}=${s.state}.forged`));
    const { rows } = await admin.query("SELECT used_at FROM river.auth_attempts WHERE state = $1", [s.state]);
    expect(rows[0].used_at).toBeNull();
    const ok = await callback(s.state, note(alice, s.nonce), s.cookie);
    expect(ok.status).toBe(303);
  });

  it("an attempt older than 10 minutes", async () => {
    const s = await start();
    await admin.query("UPDATE river.auth_attempts SET created_at = now() - interval '11 minutes' WHERE state = $1", [s.state]);
    expectRefused(await callback(s.state, note(alice, s.nonce), s.cookie));
  });
});

/** A signed-in member's cookie (alice). */
async function member(): Promise<string> {
  const s = await start();
  const result = await callback(s.state, note(alice, s.nonce), s.cookie);
  return sessionFrom(result) ?? "";
}

function post(path: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("sessions and Origin (Appendix B)", () => {
  it("state-changing routes refuse a missing or foreign Origin", async () => {
    const cookie = await member();
    const attempts: Array<Record<string, string>> = [{ cookie }, { cookie, origin: "https://evil.example" }, { cookie, origin: "null" }];
    for (const headers of attempts) {
      expect((await post("/read-state", { read: [] }, headers)).status).toBe(403);
      expect((await post("/auth/signout", {}, headers)).status).toBe(403);
    }
  });

  it("a tampered or foreign session cookie reads as a visitor and is cleared", async () => {
    const cookie = await member();
    const tampered = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const res = await fetch(`${API}/feed`, { headers: { cookie: tampered } });
    expect(((await res.json()) as { viewer: unknown }).viewer).toBeNull();
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION}=;`))).toBe(true);
  });

  it("sign out clears the session cookie", async () => {
    const cookie = await member();
    const res = await post("/auth/signout", {}, { cookie, origin });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()).toEqual([`${SESSION}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`]);
  });
});

describe("a member's read state (check 23, API side)", () => {
  interface Feed {
    items: Array<{ id: string; read?: boolean }>;
    circles: Array<{ id: string; name: string }>;
    viewer: unknown;
  }
  const feed = async (cookie?: string, query = ""): Promise<Feed> =>
    (await (await fetch(`${API}/feed${query}`, { headers: cookie ? { cookie } : {} })).json()) as Feed;

  it("visitors can't write it, and their feed carries no read field", async () => {
    expect((await post("/read-state", { read: [] }, { origin })).status).toBe(401);
    expect((await post("/read-state/all", {}, { origin })).status).toBe(401);
    const visitor = await feed();
    expect(visitor.viewer).toBeNull();
    expect(visitor.items.every((i) => i.read === undefined)).toBe(true);
  });

  it("Mark read and Mark unread persist; bad ids are refused", async () => {
    const cookie = await member();
    const before = await feed(cookie);
    const [a, b] = before.items;
    expect(a.read).toBe(false);
    expect((await post("/read-state", { read: [a.id, b.id] }, { cookie, origin })).status).toBe(204);
    let after = await feed(cookie);
    expect(after.items.find((i) => i.id === a.id)?.read).toBe(true);
    expect(after.items.find((i) => i.id === b.id)?.read).toBe(true);
    expect((await post("/read-state", { unread: [a.id] }, { cookie, origin })).status).toBe(204);
    after = await feed(cookie);
    expect(after.items.find((i) => i.id === a.id)?.read).toBe(false);
    expect(after.items.find((i) => i.id === b.id)?.read).toBe(true);

    expect((await post("/read-state", { read: ["not-a-uuid"] }, { cookie, origin })).status).toBe(400);
    expect((await post("/read-state", { read: "x" }, { cookie, origin })).status).toBe(400);
    // An id that names no item is ignored, not an error.
    expect((await post("/read-state", { read: ["00000000-0000-4000-8000-00000000dead"] }, { cookie, origin })).status).toBe(204);
  });

  it("Mark all read covers the member's current view only", async () => {
    const cookie = await member();
    await post("/read-state", { unread: (await feed(cookie)).items.map((i) => i.id) }, { cookie, origin });
    const circles = (await feed(cookie)).circles;
    const soccer = circles.find((c) => c.name === "Soccer");
    expect(soccer).toBeDefined();
    const res = await post("/read-state/all", { circle: soccer!.id }, { cookie, origin });
    expect(res.status).toBe(200);
    const { marked } = (await res.json()) as { marked: number };
    expect(marked).toBeGreaterThan(0);
    const inSoccer = await feed(cookie, `?circle=${soccer!.id}`);
    expect(inSoccer.items.every((i) => i.read)).toBe(true);
    const everything = await feed(cookie);
    expect(everything.items.some((i) => i.read === false)).toBe(true);
    expect((await post("/read-state/all", { circle: "Soccer" }, { cookie, origin })).status).toBe(400);
    expect((await post("/read-state/all", { circle: [soccer!.id, 7] }, { cookie, origin })).status).toBe(400);
  });

  it("several circles: the feed and Mark all read take any of them (ui-revisions-4 item 1)", async () => {
    const cookie = await member();
    await post("/read-state", { unread: (await feed(cookie)).items.map((i) => i.id) }, { cookie, origin });
    const circles = (await feed(cookie)).circles;
    const family = circles.find((c) => c.name === "Family")!;
    const soccer = circles.find((c) => c.name === "Soccer")!;
    const both = await feed(cookie, `?circle=${family.id}&circle=${soccer.id}`);
    const one = [
      ...(await feed(cookie, `?circle=${family.id}`)).items.map((i) => ({ ...i, circle: family.id })),
      ...(await feed(cookie, `?circle=${soccer.id}`)).items.map((i) => ({ ...i, circle: soccer.id })),
    ];
    expect(one.length).toBeGreaterThan(0);
    // The newest of either circle's items: each is on that circle's own first page.
    expect(both.items.length).toBeGreaterThanOrEqual(Math.max(...[family, soccer].map((c) => one.filter((i) => i.circle === c.id).length)));
    const ids = new Set(one.map((i) => i.id));
    expect(both.items.every((i) => ids.has(i.id))).toBe(true);
    const res = await post("/read-state/all", { circle: [family.id, soccer.id] }, { cookie, origin });
    expect(res.status).toBe(200);
    expect((await feed(cookie, `?circle=${family.id}&circle=${soccer.id}`)).items.every((i) => i.read)).toBe(true);
    expect((await feed(cookie)).items.some((i) => i.read === false)).toBe(true);
  });
});
