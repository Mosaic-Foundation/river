// The follow box, the Following page and circles over HTTP (spec F6, F7, F8; checks 13, 15 and the
// error sentences), against the running dev server (`npm run dev`, reading .env with
// FETCH_FIXTURES_DIR and TEST_CLOCK_NOW). Members sign in through the River's real callback with a
// test DID whose log this file serves on :3005 (in TRUSTED_DID_HOSTS, read over loopback because
// TEST_DID_LOOPBACK=1), exactly as tests/api/signin.test.ts does; each run is a new member.
import { generateKeyPairSync, randomBytes, sign as edSign } from "node:crypto";
import http from "node:http";
import { createDID, MultibaseEncoding, multibaseEncode, prepareDataForSigning, type Signer } from "didwebvh-ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const API = process.env.API_URL ?? "http://localhost:3000";
const PORT = 3005;
const SESSION = "__Host-river-session";
const STATE = "__Host-river-signin";

let server: http.Server;
const logs = new Map<string, string>();
let origin: string;
let cookie: string;

/** A did:webvh like the identity host's, served from this file's log server. */
async function testDid() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url");
  const multikey = multibaseEncode(new Uint8Array([0xed, 0x01, ...raw]), MultibaseEncoding.BASE58_BTC);
  const code = randomBytes(5).toString("hex").slice(0, 8);
  const id = `did:webvh:{SCID}:localhost%3A${PORT}:u:${code}`;
  const signer: Signer = {
    getVerificationMethodId: () => `did:key:${multikey}#${multikey}`,
    async sign({ document, proof }) {
      const data = await prepareDataForSigning(document, proof);
      return { proofValue: multibaseEncode(new Uint8Array(edSign(null, data, privateKey)), MultibaseEncoding.BASE58_BTC) };
    },
  };
  const result = await createDID({
    address: `localhost:${PORT}`,
    paths: ["u", code],
    signer,
    verifier: { verify: async () => true },
    updateKeys: [multikey],
    didDocument: {
      "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
      id,
      controller: id,
      verificationMethod: [{ id: `${id}#key-1`, type: "Multikey", controller: id, publicKeyMultibase: multikey }],
      authentication: [`${id}#key-1`],
    },
    portable: true,
    witness: null,
    watchers: null,
    created: `${new Date(Date.now() - 60_000).toISOString().slice(0, 19)}Z`,
  });
  logs.set(`/u/${code}/did.jsonl`, result.log.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  return { did: result.did, privateKey };
}

/** Signs a new member in through GET /auth/signin and the River's callback; returns the session cookie. */
async function signIn(): Promise<string> {
  const who = await testDid();
  const started = await fetch(`${API}/auth/signin`, { redirect: "manual" });
  const url = new URL(started.headers.get("location") ?? "");
  const state = url.searchParams.get("state") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  origin = new URL(url.searchParams.get("client_id") ?? "").origin;
  const stateCookie = (started.headers.getSetCookie().find((c) => c.startsWith(`${STATE}=`)) ?? "").split(";")[0] ?? "";
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "EdDSA", kid: `${who.did}#key-1` })}.${b64({ iss: who.did, sub: who.did, aud: origin, nonce, iat: now, exp: now + 120 })}`;
  const jws = `${input}.${edSign(null, Buffer.from(input, "ascii"), who.privateKey).toString("base64url")}`;
  const res = await fetch(`${API}/auth/callback?${new URLSearchParams({ state, note: jws })}`, {
    redirect: "manual",
    headers: { cookie: stateCookie },
  });
  const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION}=`) && !c.startsWith(`${SESSION}=;`));
  if (res.status !== 303 || !session) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return session.split(";")[0] ?? "";
}

beforeAll(async () => {
  try {
    await fetch(`${API}/health`);
  } catch {
    throw new Error(`No API at ${API}. Start it with \`npm run dev\` (see tests/api/README.md).`);
  }
  server = http.createServer((req, res) => {
    const body = logs.get(req.url ?? "");
    if (body === undefined) res.writeHead(404).end();
    else res.writeHead(200, { "content-type": "text/jsonl" }).end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, () => resolve());
  });
  // The seed spaces exist once anyone has opened the River (a fresh db reset has none yet).
  await fetch(`${API}/feed`);
  cookie = await signIn();
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie, origin }) {
  return fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface Page {
  spaces: Array<{ id: string; name: string; following: boolean; address: string; kind: string; iconUrl: string | null; circleIds: string[]; streams: Array<{ key: string; rule: string | null }> }>;
  quiet: string[];
  ended: unknown[];
  circles: Array<{ id: string; name: string; role: string | null; color: string | null; spaceIds: string[] }>;
}

async function page(): Promise<Page> {
  const res = await call("GET", "/following", undefined, { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
}

/** Every page of the member's feed. */
async function feedItems(): Promise<Array<{ space: { id: string }; boostOf: unknown }>> {
  const items: Array<{ space: { id: string }; boostOf: unknown }> = [];
  let cursor: string | null = null;
  for (let n = 0; n < 100; n++) {
    const res = await fetch(`${API}/feed${cursor ? `?cursor=${cursor}` : ""}`, { headers: { cookie } });
    const body = (await res.json()) as { items: typeof items; nextCursor: string | null };
    items.push(...body.items);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return items;
}

describe("members only, from the River's own pages", () => {
  it("visitors get 401 everywhere; a foreign Origin gets 403", async () => {
    const visitor = { origin };
    const requests: Array<[string, string, unknown?]> = [
      ["POST", "/follow/preview", { input: "https://demosville.civic.social" }],
      ["POST", "/follows", { input: "https://demosville.civic.social" }],
      ["GET", "/following"],
      ["POST", "/following/quiet/unfollow", {}],
      ["POST", "/circles", { name: "X", color: "#123456" }],
      ["DELETE", "/following/spaces/00000000-0000-4000-8000-000000000001"],
    ];
    for (const [method, path, body] of requests) {
      expect((await call(method, path, body, visitor)).status, `${method} ${path}`).toBe(401);
      if (method !== "GET") {
        expect((await call(method, path, body, { cookie, origin: "https://evil.example" })).status, `${method} ${path}`).toBe(403);
        expect((await call(method, path, body, { cookie })).status, `${method} ${path}`).toBe(403);
      }
    }
  });
});

describe("the Following page's viewer", () => {
  it("names who is signed in, for the page's profile menu", async () => {
    const body = (await page()) as Page & { viewer?: { did: string | null; displayName: string | null } };
    expect(body.viewer?.did).toMatch(/^did:/);
    expect(body.viewer).toHaveProperty("displayName");
  });
});

describe("the follow box over HTTP (spec F6)", () => {
  it("check 13: previews Demosville (name, initials), then following it shows its items", async () => {
    // A new member starts with the seed follows; unfollow Demosville to follow it from the box.
    const before = await page();
    const demosville = before.spaces.find((s) => s.address === "demosville.civic.social")!;
    expect(demosville.following).toBe(true);
    expect((await call("DELETE", `/following/spaces/${demosville.id}`)).status).toBe(204);
    expect((await feedItems()).some((i) => i.space.id === demosville.id)).toBe(false);

    const res = await call("POST", "/follow/preview", { input: "https://demosville.civic.social" });
    expect(res.status).toBe(200);
    const { preview } = (await res.json()) as { preview: Record<string, unknown> };
    expect(preview).toMatchObject({ name: "Demosville Civic Hub", iconUrl: null, kind: "Civic Hub", stream: null });

    const civic = before.circles.find((c) => c.role === "civic")!;
    const followed = await call("POST", "/follows", { input: "https://demosville.civic.social", scope: "space", circleIds: [civic.id] });
    expect(followed.status).toBe(201);
    expect(((await followed.json()) as { spaceId: string }).spaceId).toBe(demosville.id);
    expect((await feedItems()).some((i) => i.space.id === demosville.id)).toBe(true);
    const after = await page();
    expect(after.spaces.find((s) => s.id === demosville.id)).toMatchObject({ following: true, circleIds: [civic.id] });
  });

  it("check 15: previews @w3c@w3c.social (name, avatar); following it shows its posts with boost cards", async () => {
    const w3c = (await page()).spaces.find((s) => s.address === "@w3c@w3c.social")!;
    expect((await call("DELETE", `/following/spaces/${w3c.id}`)).status).toBe(204);
    const res = await call("POST", "/follow/preview", { input: "@w3c@w3c.social" });
    const { preview } = (await res.json()) as { preview: Record<string, unknown> };
    expect(preview).toMatchObject({ name: "World Wide Web Consortium", kind: "Mastodon account", address: "@w3c@w3c.social" });
    expect(preview.iconUrl).toMatch(/^https:\/\//);
    // A circle of its own, so the feed can be narrowed to it.
    const made = await call("POST", "/circles", { name: "Just W3C", color: "#005A9C" });
    const { circle } = (await made.json()) as { circle: { id: string } };
    expect((await call("POST", "/follows", { input: "@w3c@w3c.social", circleIds: [circle.id] })).status).toBe(201);
    const res2 = await fetch(`${API}/feed?circle=${circle.id}`, { headers: { cookie } });
    const items = ((await res2.json()) as { items: Array<{ space: { id: string }; boostOf: unknown; kind: string }> }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.space.id === w3c.id)).toBe(true);
    expect(items.some((i) => i.boostOf !== null)).toBe(true);
    expect(items.some((i) => i.boostOf === null)).toBe(true);
    expect((await call("DELETE", `/circles/${circle.id}`)).status).toBe(204);
  });

  it("answers in spec F6's words, with nothing stored", async () => {
    const cases: Array<[string, string]> = [
      ["http://example.org", "This address can't be followed"],
      ["https://10.0.0.5", "This address can't be followed"],
      ["just words", "That address isn't a Space we can follow"],
      ["https://floyd.civic.social/process/proc_0000000000000000", "That address isn't a Space we can follow"],
      ["https://nothing-recorded.example", "We couldn't reach that address"],
    ];
    for (const [input, message] of cases) {
      for (const path of ["/follow/preview", "/follows"]) {
        const res = await call("POST", path, { input });
        expect(res.status, `${path} ${input}`).toBe(422);
        expect(((await res.json()) as { message: string }).message, `${path} ${input}`).toBe(message);
      }
    }
    expect((await call("POST", "/follows", { input: "https://demosville.civic.social", scope: "stream" })).status).toBe(400);
    expect((await call("POST", "/follows", { input: "https://demosville.civic.social", circleIds: ["Civic"] })).status).toBe(400);
  });
});

describe("circles over HTTP (spec F8)", () => {
  it("create, rename, recolor, add and remove a space, delete; the civic circle stays", async () => {
    const created = await call("POST", "/circles", { name: "Book club", color: "#336699" });
    expect(created.status).toBe(201);
    const { circle } = (await created.json()) as { circle: { id: string } };
    const space = (await page()).spaces.find((s) => s.following)!;
    expect((await call("PUT", `/circles/${circle.id}/spaces/${space.id}`)).status).toBe(204);
    expect((await call("PATCH", `/circles/${circle.id}`, { name: "Readers", color: "#663399" })).status).toBe(200);
    let circles = (await page()).circles;
    expect(circles.find((c) => c.id === circle.id)).toMatchObject({ name: "Readers", color: "#663399", spaceIds: [space.id] });
    // The feed's circle chips follow.
    const feed = (await (await fetch(`${API}/feed?circle=${circle.id}`, { headers: { cookie } })).json()) as { items: Array<{ space: { id: string } }> };
    expect(feed.items.every((i) => i.space.id === space.id)).toBe(true);

    expect((await call("DELETE", `/circles/${circle.id}/spaces/${space.id}`)).status).toBe(204);
    expect((await call("DELETE", `/circles/${circle.id}`)).status).toBe(204);
    circles = (await page()).circles;
    expect(circles.some((c) => c.id === circle.id)).toBe(false);

    const civic = circles.find((c) => c.role === "civic")!;
    const refused = await call("DELETE", `/circles/${civic.id}`);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { message: string }).message).toBe("The Civic circle can't be deleted. You can rename it.");
    expect((await call("PATCH", `/circles/${civic.id}`, { name: "Town" })).status).toBe(200);
    expect((await page()).circles.find((c) => c.id === civic.id)).toMatchObject({ name: "Town", role: "civic" });
    expect((await call("PATCH", `/circles/not-an-id`, { name: "Town" })).status).toBe(404);
  });
});
