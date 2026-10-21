// The identity host over HTTP (`npm run dev:identity`, reading .env.identity with
// EMAIL_TRANSPORT=capture and TEST_ROUTES=1): the authorize request checks (check 12), the
// WebAuthn options the spec fixes (4.6), recovery's uniform answer (check 36), link expiry,
// rate limits, the CSP and same-origin POSTs. The passkey ceremonies themselves run in
// Playwright with a virtual authenticator (tests/e2e/identity.spec.ts).
import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const ID = process.env.IDENTITY_API_URL ?? "http://localhost:3001";
const CLIENT = "http://localhost:5173";
const CALLBACK = `${CLIENT}/api/auth/callback`;

function opaque(): string {
  return randomBytes(24).toString("base64url");
}

function authorize(params: Record<string, string>): Promise<Response> {
  return fetch(`${ID}/authorize?${new URLSearchParams(params)}`, { redirect: "manual" });
}

const valid = () => ({ client_id: CLIENT, redirect_uri: CALLBACK, state: opaque(), nonce: opaque() });

async function newRequest(): Promise<string> {
  const res = await authorize(valid());
  expect(res.status).toBe(200);
  const id = /data-request="([0-9a-f-]{36})"/.exec(await res.text())?.[1];
  if (!id) throw new Error("no request id on the authorize page");
  return id;
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${ID}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ID, ...headers },
    body: JSON.stringify(body),
  });
}

function postForm(path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${ID}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ID },
    body: new URLSearchParams(fields).toString(),
  });
}

async function mailbox(to: string): Promise<Array<{ kind: string; text: string }>> {
  const res = await fetch(`${ID}/test/mailbox?to=${encodeURIComponent(to)}`);
  return ((await res.json()) as { messages: Array<{ kind: string; text: string }> }).messages;
}

beforeEach(async () => {
  await fetch(`${ID}/test/rate-limits/reset`, { method: "POST" });
  await fetch(`${ID}/test/clock`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"offsetMs":0}' });
});

afterAll(async () => {
  await fetch(`${ID}/test/rate-limits/reset`, { method: "POST" });
});

describe("GET /authorize (check 12)", () => {
  it("serves the page for a registered client and its exact redirect_uri, with the Appendix B CSP", async () => {
    const res = await authorize(valid());
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    // No inline script: the only <script> loads /passkey.js.
    expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script type="module" src="/passkey.js">']);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/style="/);
    // Every input has a label.
    for (const id of html.matchAll(/<input id="([^"]+)"/g)) expect(html).toContain(`<label for="${id[1]}">`);
  });

  it("refuses anything but an exact registered pair, and never redirects", async () => {
    const cases: Array<Record<string, string>> = [
      { ...valid(), redirect_uri: `${CALLBACK}/` },
      { ...valid(), redirect_uri: `${CALLBACK}?a=1` },
      { ...valid(), redirect_uri: `${CALLBACK}#x` },
      { ...valid(), redirect_uri: "http://localhost:5174/api/auth/callback" },
      { ...valid(), redirect_uri: "http://127.0.0.1:5173/api/auth/callback" },
      { ...valid(), redirect_uri: "https://evil.example/api/auth/callback" },
      { ...valid(), client_id: "https://evil.example" },
      { ...valid(), client_id: `${CLIENT}/` },
      { ...valid(), state: "short" },
      { ...valid(), nonce: "" },
    ];
    for (const params of cases) {
      const res = await authorize(params);
      expect(res.status, JSON.stringify(params)).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.text()).not.toContain("data-request");
    }
    const { state, ...noState } = valid();
    void state;
    expect((await authorize(noState)).status).toBe(400);
  });

  it("is rate-limited per IP", async () => {
    let status = 200;
    for (let i = 0; i < 70 && status === 200; i++) status = (await authorize(valid())).status;
    expect(status).toBe(429);
  });
});

describe("passkey options (spec 4.6)", () => {
  it("sign-in: a fresh 32-byte challenge each time, empty allowCredentials, user verification required", async () => {
    const request = await newRequest();
    const first = await (await post("/authorize/signin/options", { request })).json();
    const second = await (await post("/authorize/signin/options", { request })).json();
    expect(first.options).toMatchObject({ rpId: "localhost", allowCredentials: [], userVerification: "required" });
    expect(Buffer.from(first.options.challenge, "base64url")).toHaveLength(32);
    expect(second.options.challenge).not.toBe(first.options.challenge);
  });

  it("sign-up: Mosaic ID, resident key and user verification required, a random 32-byte user id", async () => {
    const request = await newRequest();
    const email = `api-${randomBytes(4).toString("hex")}@example.test`;
    const res = await post("/authorize/signup/options", { request, email, display_name: "Ada" });
    expect(res.status).toBe(200);
    const { options } = await res.json();
    expect(options.rp).toEqual({ name: "Mosaic ID", id: "localhost" });
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(options.attestation).toBe("none");
    expect(options.excludeCredentials).toEqual([]);
    expect(options.user.name).toBe(email);
    expect(options.user.displayName).toBe("Ada");
    const userId = Buffer.from(options.user.id, "base64url");
    expect(userId).toHaveLength(32);
    expect(userId.toString("utf8")).not.toContain(email);
    expect(Buffer.from(options.challenge, "base64url")).toHaveLength(32);
  });

  it("check 35: sign-up refuses an invalid email address", async () => {
    const request = await newRequest();
    for (const email of ["", "nope", "a@b", "a b@example.test", 5]) {
      const res = await post("/authorize/signup/options", { request, email });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_email", message: "Enter a valid email address." });
    }
  });

  it("refuses unknown, used-up and malformed requests and assertions", async () => {
    expect((await post("/authorize/signin/options", { request: "00000000-0000-4000-8000-000000000000" })).status).toBe(410);
    expect((await post("/authorize/signin/options", { request: "not-a-uuid" })).status).toBe(400);
    const request = await newRequest();
    const junk = await post("/authorize/signin/verify", { request, response: { id: "x".repeat(20), rawId: "x", type: "public-key", response: {} } });
    expect(junk.status).toBe(400);
    expect((await junk.json()).error).toBe("unknown_passkey");
    const bad = await post("/authorize/signup/verify", { request, response: { nope: true } });
    expect(bad.status).toBe(410); // no sign-up was started on this request
  });

  it("sign-up options are rate-limited per IP", async () => {
    const request = await newRequest();
    let status = 200;
    for (let i = 0; i < 15 && status !== 429; i++) {
      status = (await post("/authorize/signup/options", { request, email: `rl-${i}-${randomBytes(3).toString("hex")}@example.test` })).status;
    }
    expect(status).toBe(429);
  });

  it("refuses POSTs from another origin", async () => {
    const request = await newRequest();
    for (const origin of ["https://evil.example", "null", ""]) {
      const res = await post("/authorize/signin/options", { request }, { origin });
      expect(res.status, origin).toBe(403);
    }
  });
});

describe("Lost your passkey? (check 36)", () => {
  it("answers the same for an unknown address and sends nothing", async () => {
    const email = `unknown-${randomBytes(4).toString("hex")}@example.test`;
    const res = await postForm("/recover", { email });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("If that address has an account, we sent a link.");
    expect(await mailbox(email)).toEqual([]);
  });

  it("is rate-limited per address without saying so, and per IP with a 429", async () => {
    const email = `limited-${randomBytes(4).toString("hex")}@example.test`;
    for (let i = 0; i < 5; i++) {
      const res = await postForm("/recover", { email });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("If that address has an account, we sent a link.");
    }
    let status = 200;
    for (let i = 0; i < 12 && status === 200; i++) {
      status = (await postForm("/recover", { email: `ip-${i}-${randomBytes(3).toString("hex")}@example.test` })).status;
    }
    expect(status).toBe(429);
  });

  it("unknown or malformed links are gone", async () => {
    for (const path of ["/recover/link?token=" + randomBytes(32).toString("base64url"), "/recover/link?token=abc", "/verify?token=" + randomBytes(32).toString("base64url")]) {
      const res = await fetch(`${ID}${path}`);
      expect(res.status, path).toBe(410);
      expect(await res.text()).toContain("This link has expired or was already used.");
    }
    expect((await post("/recover/options", { token: randomBytes(32).toString("base64url") })).status).toBe(410);
    expect((await postForm("/verify", { token: randomBytes(32).toString("base64url") })).status).toBe(410);
  });
});

describe("did.jsonl", () => {
  it("answers 404 for a code nobody has", async () => {
    for (const code of ["zzzzzzzz", "ABCDEFGH", "abc"]) {
      const res = await fetch(`${ID}/u/${code}/did.jsonl`);
      expect(res.status, code).toBe(404);
    }
  });
});

describe("check 28: no private key material in any answer", () => {
  it("none of the pages or JSON answers carries a private key", async () => {
    const request = await newRequest();
    const bodies = await Promise.all(
      [
        fetch(`${ID}/`),
        fetch(`${ID}/recover`),
        fetch(`${ID}/account/email`),
        fetch(`${ID}/identity.css`),
        fetch(`${ID}/passkey.js`),
        post("/authorize/signin/options", { request }),
        post("/authorize/signup/options", { request, email: `k-${randomBytes(3).toString("hex")}@example.test` }),
        post("/account/email/options", { email: "x@example.test" }),
      ].map(async (res) => (await res).text()),
    );
    for (const body of bodies) {
      for (const marker of ["PRIVATE KEY", '"d":', "secretKeyMultibase", "private_key", "wrapped_dek", "IDENTITY_MASTER_KEY"]) {
        expect(body).not.toContain(marker);
      }
    }
  });
});
