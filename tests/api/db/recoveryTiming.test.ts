// "Lost your passkey?" answers in the same time for a known address as an unknown one (security
// review of 3a86e8f, item 6): the lookup and the email happen after the answer. People are made as
// identity_app through createPerson(), and confirmed and asked about over HTTP against the identity
// dev server (`npm run dev:identity`), whose capture transport is slowed down through TEST_ROUTES
// so a request that waited for the email would show it.
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { forIdentity } from "../../../src/db/context.js";
import { createPerson, newWebauthnUserId } from "../../../src/identity/people.js";
import { recoveryKeyFromPem } from "../../../src/identity/recovery/key.js";
import { insertAuthRequest, randomToken } from "../../../src/identity/store.js";
import { IDENTITY_URL, requireDatabase, rolePool } from "./roles.js";

const identity = rolePool(IDENTITY_URL);
const ID = process.env.IDENTITY_API_URL ?? "http://localhost:3001";
const DELAY_MS = 1500;

beforeAll(async () => {
  vi.stubEnv("IDENTITY_MASTER_KEY", randomBytes(32).toString("base64"));
  await requireDatabase(identity, "identity_app");
  await fetch(`${ID}/test/rate-limits/reset`, { method: "POST" });
});

afterEach(async () => {
  await fetch(`${ID}/test/email-delay`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"ms":0}' });
});

afterAll(async () => {
  await identity.end();
});

function form(path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${ID}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ID },
    body: new URLSearchParams(fields).toString(),
  });
}

async function recoverMail(to: string): Promise<number> {
  const res = await fetch(`${ID}/test/mailbox?to=${encodeURIComponent(to)}`);
  return ((await res.json()) as { messages: Array<{ kind: string }> }).messages.filter((m) => m.kind === "recover").length;
}

/** A person whose address is confirmed, so recovery would send them a link. */
async function verifiedPerson(): Promise<string> {
  const email = `timing-${randomBytes(4).toString("hex")}@example.test`;
  const requestId = randomUUID();
  await forIdentity(
    { authRequestId: requestId },
    (db) =>
      insertAuthRequest(db, {
        id: requestId,
        purpose: "authorize",
        client: { clientId: "http://localhost:5173", redirectUri: "http://localhost:5173/api/auth/callback", state: randomToken(), nonce: randomToken() },
        challenge: randomToken(),
        now: new Date(),
      }),
    identity,
  );
  const recovery = recoveryKeyFromPem(generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  const created = await createPerson(
    {
      origin: ID,
      recoveryMultikey: recovery.multikey,
      email,
      webauthnUserId: newWebauthnUserId(),
      credential: { id: randomBytes(32).toString("base64url"), publicKey: randomBytes(77), counter: 0, transports: ["internal"] },
      requestId,
      now: new Date(Date.now() - 5_000),
    },
    identity,
  );
  expect((await form("/verify", { token: created.verifyToken })).status).toBe(200);
  return email;
}

async function timed(email: string): Promise<{ ms: number; body: string }> {
  const started = performance.now();
  const res = await form("/recover", { email });
  const body = await res.text();
  expect(res.status).toBe(200);
  return { ms: performance.now() - started, body };
}

describe("Lost your passkey? doesn't wait for the email", () => {
  it("answers a known address as fast as an unknown one, then sends the link", async () => {
    const known = await verifiedPerson();
    await fetch(`${ID}/test/email-delay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ms: DELAY_MS }) });

    const unknown = await timed(`nobody-${randomBytes(4).toString("hex")}@example.test`);
    const found = await timed(known);
    expect(found.ms).toBeLessThan(DELAY_MS / 2);
    expect(found.body).toBe(unknown.body);
    expect(await recoverMail(known)).toBe(0);

    // The link still goes out, after the answer.
    let sent = 0;
    for (let i = 0; i < 40 && sent === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      sent = await recoverMail(known);
    }
    expect(sent).toBe(1);
  });
});
