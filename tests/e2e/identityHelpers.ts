// Helpers for the identity host's end-to-end tests (M7): Chromium's virtual WebAuthn authenticator
// over CDP, the capture mailbox and clock behind TEST_ROUTES, the River client the identity host
// knows, and read-only database checks as the local stack's postgres role.
import { createPrivateKey, createPublicKey, randomBytes, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import type { APIRequestContext, CDPSession, Page } from "@playwright/test";
import { MultibaseEncoding, multibaseDecode, multibaseEncode, resolveDIDFromLog, type DIDLog } from "didwebvh-ts";
import pg from "pg";
import { identityURL } from "../../playwright.config";

/** The River origin the identity host lists in RIVER_CLIENT_ORIGINS (5173 locally, 4173 in CI). */
export const CLIENT = new URL(process.env.E2E_BASE_URL || "http://localhost:5173").origin;
export const CALLBACK = `${CLIENT}/api/auth/callback`;

export const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export function opaque(): string {
  return randomBytes(24).toString("base64url");
}

export function testEmail(label: string): string {
  return `${label}-${randomBytes(5).toString("hex")}@example.test`;
}

export function authorizeUrl(state = opaque(), nonce = opaque(), redirectUri = CALLBACK, clientId = CLIENT): string {
  const url = new URL("/authorize", identityURL);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, nonce }).toString();
  return url.toString();
}

export interface Authenticator {
  cdp: CDPSession;
  id: string;
}

/** A platform authenticator with resident keys and user verification, as a phone or laptop has. */
export async function addAuthenticator(page: Page): Promise<Authenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, id: authenticatorId };
}

export async function removeAuthenticator(auth: Authenticator): Promise<void> {
  await auth.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: auth.id });
}

export interface VirtualCredential {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  userHandle?: string;
  signCount: number;
}

export async function credentials(auth: Authenticator): Promise<VirtualCredential[]> {
  const { credentials } = await auth.cdp.send("WebAuthn.getCredentials", { authenticatorId: auth.id });
  return credentials;
}

/** Answers the River's callback in the browser (the River's side of sign-in arrives in M8). */
export async function catchCallback(page: Page): Promise<void> {
  await page.route(`${CALLBACK}?**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>River callback</title><p>callback</p>" }),
  );
}

export interface Note {
  header: { alg: string; kid: string };
  payload: { iss: string; sub: string; aud: string; nonce: string; iat: number; exp: number };
  signingInput: string;
  signature: Buffer;
}

export function parseNote(jws: string): Note {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("not a compact JWS");
  const decode = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  return {
    header: decode(parts[0]),
    payload: decode(parts[1]),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], "base64url"),
  };
}

/** Reads state and note from the callback URL the identity host redirected to. */
export function callbackParams(url: string): { state: string; note: Note; raw: string } {
  const parsed = new URL(url);
  if (`${parsed.origin}${parsed.pathname}` !== CALLBACK) throw new Error(`not the callback: ${url}`);
  const raw = parsed.searchParams.get("note") ?? "";
  return { state: parsed.searchParams.get("state") ?? "", note: parseNote(raw), raw };
}

/** Signs up on a fresh authorize page; returns the redirect the reminder's Continue link holds. */
export async function signUp(page: Page, email: string, name?: string): Promise<{ redirect: string; state: string; nonce: string }> {
  const state = opaque();
  const nonce = opaque();
  await page.goto(authorizeUrl(state, nonce));
  await page.getByLabel("Email address").fill(email);
  if (name) await page.getByLabel(/Your name/).fill(name);
  await page.getByRole("button", { name: "Create a passkey" }).click();
  const link = page.getByRole("link", { name: "Continue to Mosaic River" });
  await link.waitFor({ state: "visible" });
  return { redirect: (await link.getAttribute("href")) ?? "", state, nonce };
}

/** Signs in on a fresh authorize page with whatever passkey the authenticator holds. */
export async function signIn(page: Page): Promise<{ url: string; state: string; nonce: string }> {
  const state = opaque();
  const nonce = opaque();
  await catchCallback(page);
  await page.goto(authorizeUrl(state, nonce));
  await page.getByRole("button", { name: "Sign in with your passkey" }).click();
  const outcome = await Promise.race([
    page.waitForURL(`${CALLBACK}?**`).then(() => "callback" as const),
    page.getByRole("link", { name: "Continue to Mosaic River" }).waitFor({ state: "visible" }).then(() => "reminder" as const),
  ]);
  if (outcome === "reminder") {
    await page.getByRole("link", { name: "Continue to Mosaic River" }).click();
    await page.waitForURL(`${CALLBACK}?**`);
  }
  return { url: page.url(), state, nonce };
}

export interface MailMessage {
  kind: string;
  to: string;
  subject: string;
  text: string;
}

export async function mailbox(request: APIRequestContext, to: string): Promise<MailMessage[]> {
  const res = await request.get(`${identityURL}/test/mailbox?to=${encodeURIComponent(to)}`);
  if (!res.ok()) throw new Error(`mailbox: ${res.status()}`);
  return ((await res.json()) as { messages: MailMessage[] }).messages;
}

export function linkIn(message: MailMessage): string {
  const match = /https?:\/\/\S+/.exec(message.text);
  if (!match) throw new Error(`no link in ${message.kind}`);
  return match[0];
}

export async function setClock(request: APIRequestContext, offsetMs: number): Promise<void> {
  const res = await request.post(`${identityURL}/test/clock`, { data: { offsetMs } });
  if (!res.ok()) throw new Error(`clock: ${res.status()}`);
}

export async function resetLimits(request: APIRequestContext): Promise<void> {
  await request.post(`${identityURL}/test/rate-limits/reset`);
}

export function codeOf(did: string): string {
  return did.split(":").pop() ?? "";
}

export async function fetchLog(request: APIRequestContext, did: string) {
  const res = await request.get(`${identityURL}/u/${codeOf(did)}/did.jsonl`);
  const text = await res.text();
  const log = text.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l)) as DIDLog;
  return { res, text, log };
}

/** did:webvh's own verification of the whole log (didwebvh-ts), with node:crypto as the verifier. */
export async function verifyWithLibrary(log: DIDLog) {
  return resolveDIDFromLog(log, {
    witnessProofs: [],
    verifier: {
      async verify(signature, message, publicKey) {
        const key = createPublicKey({
          key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey).toString("base64url") },
          format: "jwk",
        });
        return verify(null, message, key, signature);
      },
    },
  });
}

/** Verifies a note's signature against a multikey (the DID document's #key-1). */
export function noteVerifies(note: Note, multikey: string): boolean {
  const raw = multibaseDecode(multikey).bytes.slice(2);
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") }, format: "jwk" });
  return verify(null, Buffer.from(note.signingInput, "ascii"), key, note.signature);
}

/**
 * The throwaway recovery key pair for this run: CI and local setup generate it outside the repo
 * and put its public half in .env.identity as IDENTITY_RECOVERY_PUBLIC_KEY (TESTING.md).
 */
export function testRecoveryKey(): { file: string; multikey: string } {
  const file = process.env.TEST_RECOVERY_KEY_FILE;
  if (!file) {
    throw new Error(
      "Set TEST_RECOVERY_KEY_FILE to the throwaway recovery key whose public half is the identity host's " +
        "IDENTITY_RECOVERY_PUBLIC_KEY (see TESTING.md).",
    );
  }
  const publicKey = createPublicKey(createPrivateKey(readFileSync(file, "utf8")));
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url");
  return { file, multikey: multibaseEncode(new Uint8Array([0xed, 0x01, ...raw]), MultibaseEncoding.BASE58_BTC) };
}

export async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
