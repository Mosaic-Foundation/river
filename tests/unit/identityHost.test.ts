// The identity host's smaller parts: clients from RIVER_CLIENT_ORIGINS (check 12's exact match),
// rate limits, email addresses and transports, the CSP, and reading the recovery key.
import { mkdtempSync, writeFileSync } from "node:fs";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { MockAgent, type Dispatcher } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildClients, findClient, parseClientOrigin } from "../../src/identity/config.js";
import { maskEmail, normalizeEmail } from "../../src/identity/email/address.js";
import { RESEND_ENDPOINT, redactedLine, sendEmail, sendWithResend } from "../../src/identity/email/index.js";
import { recoverMessage, verifyEmailMessage } from "../../src/identity/email/messages.js";
import { IDENTITY_CSP, PERMISSIONS_POLICY, securityHeaders } from "../../src/identity/http.js";
import { esc } from "../../src/identity/pages.js";
import { LIMITS, hit, resetRateLimits } from "../../src/identity/rateLimit.js";
import { recoveryKeyFromFile, recoveryKeyFromPem, recoveryKeyFromPrompt } from "../../src/identity/recovery/key.js";
import { displayNameParam, opaqueParam } from "../../src/identity/flows/common.js";
import { recoverAddressKey } from "../../src/identity/flows/recover.js";
import { createFetchGuard, type Resolver } from "../../src/shared/fetch/index.js";

describe("clients from RIVER_CLIENT_ORIGINS (check 12)", () => {
  const clients = buildClients(["https://river.mosaic.social", "http://localhost:5173"]);

  it("each origin gets exactly its /api/auth/callback", () => {
    expect([...clients.values()]).toEqual([
      { clientId: "https://river.mosaic.social", redirectUris: ["https://river.mosaic.social/api/auth/callback"], name: "Mosaic River" },
      { clientId: "http://localhost:5173", redirectUris: ["http://localhost:5173/api/auth/callback"], name: "Mosaic River" },
    ]);
  });

  it("matches client_id and redirect_uri exactly, with no normalization", () => {
    expect(findClient(clients, "https://river.mosaic.social", "https://river.mosaic.social/api/auth/callback")).toBeDefined();
    for (const [id, uri] of [
      ["https://river.mosaic.social", "https://river.mosaic.social/api/auth/callback/"],
      ["https://river.mosaic.social", "https://river.mosaic.social/api/auth/callback?x=1"],
      ["https://river.mosaic.social", "https://River.mosaic.social/api/auth/callback"],
      ["https://river.mosaic.social", "https://river.mosaic.social:443/api/auth/callback"],
      ["https://river.mosaic.social/", "https://river.mosaic.social/api/auth/callback"],
      ["https://river.mosaic.social", "http://localhost:5173/api/auth/callback"],
      ["https://evil.example", "https://evil.example/api/auth/callback"],
      [undefined, "https://river.mosaic.social/api/auth/callback"],
      [["https://river.mosaic.social"], "https://river.mosaic.social/api/auth/callback"],
    ] as const) {
      expect(findClient(clients, id, uri), `${String(id)} ${uri}`).toBeUndefined();
    }
  });

  it("refuses paths, credentials and plain http off localhost", () => {
    expect(parseClientOrigin("https://river.mosaic.social/")).toBe("https://river.mosaic.social");
    for (const bad of ["https://river.mosaic.social/app", "http://river.mosaic.social", "https://u:p@river.mosaic.social", "river.mosaic.social"]) {
      expect(() => parseClientOrigin(bad), bad).toThrow(/RIVER_CLIENT_ORIGINS/);
    }
  });
});

describe("rate limits", () => {
  afterEach(() => resetRateLimits());

  it("allows max hits per window per key, then refuses until the window passes", () => {
    const { max, windowMs } = LIMITS.recoverAddress;
    const t0 = 1_000_000;
    for (let i = 0; i < max; i++) expect(hit("recoverAddress", "a", t0 + i)).toBe(true);
    expect(hit("recoverAddress", "a", t0 + max)).toBe(false);
    expect(hit("recoverAddress", "b", t0 + max)).toBe(true);
    expect(hit("signup", "a", t0)).toBe(true);
    expect(hit("recoverAddress", "a", t0 + windowMs)).toBe(true);
  });

  it("keys the per-address recovery limit on the IP and the address together (security review item 6)", () => {
    const key = recoverAddressKey("203.0.113.5", "ada@example.org");
    expect(recoverAddressKey("203.0.113.5", "ada@example.org")).toBe(key);
    expect(recoverAddressKey("198.51.100.7", "ada@example.org")).not.toBe(key);
    expect(recoverAddressKey("203.0.113.5", "bob@example.org")).not.toBe(key);
    expect(key).not.toContain("ada");
    // A stranger elsewhere using up the window leaves the owner's own allowance untouched.
    resetRateLimits();
    const t0 = 5_000_000;
    for (let i = 0; i < LIMITS.recoverAddress.max + 2; i++) hit("recoverAddress", recoverAddressKey("198.51.100.7", "ada@example.org"), t0 + i);
    expect(hit("recoverAddress", key, t0 + 10)).toBe(true);
  });

  it("covers /authorize and sign-up per IP and recovery per IP and per address (spec 4.6)", () => {
    expect(Object.keys(LIMITS).sort()).toEqual(["authorize", "links", "recoverAddress", "recoverIp", "signup"]);
    for (let i = 0; i < LIMITS.signup.max; i++) hit("signup", "198.51.100.7");
    expect(hit("signup", "198.51.100.7")).toBe(false);
    resetRateLimits();
    expect(hit("signup", "198.51.100.7")).toBe(true);
  });
});

describe("email addresses", () => {
  it("normalizes valid addresses and refuses the rest", () => {
    expect(normalizeEmail("  Ada.Lovelace+river@Example.ORG ")).toBe("ada.lovelace+river@example.org");
    for (const bad of ["", "a", "a@b", "@example.org", "a@@example.org", "a b@example.org", "a@example", "a@-x.org", ".a@example.org", "a..b@example.org", `${"a".repeat(65)}@example.org`, 42, undefined]) {
      expect(normalizeEmail(bad), String(bad)).toBeUndefined();
    }
  });

  it("masks addresses for logs and messages", () => {
    expect(maskEmail("ada@example.org")).toBe("a***@e***.org");
    expect(maskEmail("b@mail.example.co")).toBe("b***@m***.co");
  });
});

describe("email transports", () => {
  it("log: one line with the kind and the masked address, never the address, link or token", () => {
    const token = randomBytes(32).toString("base64url");
    const message = recoverMessage("ada@example.org", `https://id.mosaic.social/recover/link?token=${token}`);
    const line = redactedLine(message);
    expect(line).toBe("email kind=recover to=a***@e***.org");
    for (const secret of ["ada@example.org", token, "http"]) expect(line).not.toContain(secret);
  });

  it("log transport writes exactly that line", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "log");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await sendEmail(verifyEmailMessage("ada@example.org", "https://id.mosaic.social/verify?token=secret", { displayName: null, signup: true }));
      expect(spy.mock.calls).toEqual([["email kind=verify_email to=a***@e***.org"]]);
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("resend: one POST to api.resend.com through the fetch guard, with the key as a bearer token", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Mosaic ID <id@mosaic.social>");
    const mock = new MockAgent();
    mock.disableNetConnect();
    const seen: Array<{ method: string; path: string; headers: unknown; body: unknown }> = [];
    mock
      .get("https://api.resend.com")
      .intercept({ path: "/emails", method: "POST" })
      .reply((opts) => {
        seen.push({ method: opts.method, path: opts.path, headers: opts.headers, body: JSON.parse(String(opts.body)) });
        return { statusCode: 200, data: { id: "email-id" } };
      });
    const resolver: Resolver = async () => [{ address: "93.184.215.14", family: 4 }];
    const guard = createFetchGuard({ resolver, dispatcher: mock as unknown as Dispatcher });
    try {
      await sendWithResend(verifyEmailMessage("ada@example.org", "https://id.mosaic.social/verify?token=t", { displayName: null, signup: true }), guard);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(RESEND_ENDPOINT).toBe("https://api.resend.com/emails");
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toEqual({
      from: "Mosaic ID <id@mosaic.social>",
      to: ["ada@example.org"],
      subject: "Confirm your email for Mosaic ID",
      text: expect.stringContaining("https://id.mosaic.social/verify?token=t"),
    });
    expect(JSON.stringify(seen[0].headers)).toContain("Bearer re_test_key");
  });
});

describe("pages and parameters", () => {
  it("the CSP has no inline scripts and connect-src 'self', and identity/vercel.json sends the same", () => {
    expect(IDENTITY_CSP).toContain("script-src 'self';");
    expect(IDENTITY_CSP).toContain("connect-src 'self'");
    expect(IDENTITY_CSP).toContain("img-src 'self' https:");
    expect(IDENTITY_CSP).not.toContain("unsafe-inline");
    const vercel = JSON.parse(readFileSync(path.resolve("identity/vercel.json"), "utf8")) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy");
    expect(csp?.value).toBe(IDENTITY_CSP);
  });

  // Security review of 3a86e8f, item 8.
  it("both vercel.json files send Permissions-Policy, the identity host's also COOP, as its pages do", () => {
    const sent = (file: string) => {
      const vercel = JSON.parse(readFileSync(path.resolve(file), "utf8")) as {
        headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
      };
      return Object.fromEntries((vercel.headers.find((h) => h.source === "/(.*)")?.headers ?? []).map((h) => [h.key, h.value]));
    };
    expect(PERMISSIONS_POLICY).toBe("camera=(), microphone=(), geolocation=(), payment=()");
    expect(sent("vercel.json")["Permissions-Policy"]).toBe(PERMISSIONS_POLICY);
    expect(sent("identity/vercel.json")["Permissions-Policy"]).toBe(PERMISSIONS_POLICY);
    expect(sent("identity/vercel.json")["Cross-Origin-Opener-Policy"]).toBe("same-origin");

    const headers = new Map<string, string>();
    securityHeaders({} as never, { setHeader: (k: string, v: string) => headers.set(k, v) } as never, () => {});
    expect(headers.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY);
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("escapes markup", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("takes opaque state and nonce values and short display names only", () => {
    expect(opaqueParam("abcdefghijklmnop")).toBe("abcdefghijklmnop");
    for (const bad of ["short", "a".repeat(257), "has space and more", "<script>alert(1)</script>", 7]) {
      expect(opaqueParam(bad)).toBeUndefined();
    }
    expect(displayNameParam("  Ada ")).toBe("Ada");
    expect(displayNameParam("")).toBeUndefined();
    expect(displayNameParam("x".repeat(65))).toBeNull();
    expect(displayNameParam("a\u0000b")).toBeNull();
    // Nothing that can reorder or hide the confirm page's warning around it (security review item 5).
    expect(displayNameParam("Ada\u202Eevil")).toBeNull();
    expect(displayNameParam("Ada\u200Bx")).toBeNull();
    expect(displayNameParam("Ada\u2028x")).toBeNull();
    expect(displayNameParam("Zoë Ångström")).toBe("Zoë Ångström");
  });
});

describe("the recovery key for recover-dids", () => {
  function pem(): string {
    return generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  }

  it("reads an Ed25519 PEM and gives its multikey", async () => {
    const key = recoveryKeyFromPem(pem());
    expect(key.multikey).toMatch(/^z6Mk/);
    expect(await key.sign(Buffer.from("x"))).toHaveLength(64);
  });

  it("refuses other keys and junk", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(() => recoveryKeyFromPem(rsa)).toThrow(/Ed25519/);
    expect(() => recoveryKeyFromPem("not a key")).toThrow(/PEM/);
  });

  it("reads a file outside the repository and refuses one inside it", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "recovery-"));
    const file = path.join(dir, "recovery.pem");
    writeFileSync(file, pem(), { mode: 0o600 });
    expect((await recoveryKeyFromFile(file)).multikey).toMatch(/^z6Mk/);
    await expect(recoveryKeyFromFile(file, dir)).rejects.toThrow(/outside the repository/);
    await expect(recoveryKeyFromFile("package.json")).rejects.toThrow(/outside the repository/);
  });

  it("reads a pasted PEM from the prompt", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const pending = recoveryKeyFromPrompt(input, output);
    input.end(`${pem()}\n`);
    expect((await pending).multikey).toMatch(/^z6Mk/);
  });
});
