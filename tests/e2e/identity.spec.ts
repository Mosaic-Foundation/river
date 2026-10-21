import AxeBuilder from "@axe-core/playwright";
import { createPrivateKey } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { identityURL } from "../../playwright.config";
import { expect, test } from "./fixtures";
import {
  CALLBACK,
  CLIENT,
  addAuthenticator,
  authorizeUrl,
  callbackParams,
  catchCallback,
  codeOf,
  credentials,
  fetchLog,
  linkIn,
  mailbox,
  noteVerifies,
  opaque,
  removeAuthenticator,
  resetLimits,
  setClock,
  signIn,
  signUp,
  testEmail,
  testRecoveryKey,
  verifyWithLibrary,
  withAdmin,
} from "./identityHelpers";

// M7, the identity host (spec 4.6, F2, F3; checks 9, 12, 28, 35, 36, 37). Chromium's virtual
// WebAuthn authenticator stands in for a phone or laptop. The River's side of sign-in (the
// callback, sessions, accounts) arrives in M8, so the callback is answered in the browser and the
// tests read the note from its URL.

const HOUR = 60 * 60_000;

test.beforeEach(async ({ request }) => {
  await resetLimits(request);
  await setClock(request, 0);
});

test.afterEach(async ({ request }) => {
  await setClock(request, 0);
});

/** Signs up and follows the Continue link; returns the note and the DID. */
async function signUpAndContinue(page: Page, email: string) {
  await catchCallback(page);
  const { redirect, state, nonce } = await signUp(page, email);
  await page.goto(redirect);
  const { note, state: returnedState } = callbackParams(page.url());
  expect(returnedState).toBe(state);
  expect(note.payload.nonce).toBe(nonce);
  return { note, did: note.payload.sub };
}

async function verifyEmail(page: Page, request: Parameters<typeof mailbox>[0], email: string): Promise<string> {
  const [message] = (await mailbox(request, email)).filter((m) => m.kind === "verify_email");
  const link = linkIn(message);
  await page.goto(link);
  await page.getByRole("button", { name: "Confirm my address" }).click();
  await expect(page.getByRole("heading", { name: "Your address is confirmed" })).toBeVisible();
  return link;
}

test("check 9: sign-up creates a passkey, a person and a DID whose log verifies", async ({ page, request }) => {
  const auth = await addAuthenticator(page);
  const email = testEmail("check9");
  const { note, did } = await signUpAndContinue(page, email);

  // A passkey: one discoverable credential on the authenticator, user handle 32 bytes.
  const creds = await credentials(auth);
  expect(creds).toHaveLength(1);
  expect(creds[0].isResidentCredential).toBe(true);
  expect(creds[0].rpId).toBe("localhost");
  expect(Buffer.from(creds[0].userHandle ?? "", "base64")).toHaveLength(32);

  // A DID of the spec's shape, and the note that carries it.
  expect(did).toMatch(/^did:webvh:Qm[1-9A-HJ-NP-Za-km-z]{44}:localhost%3A3001:u:[a-z2-7]{8}$/);
  expect(note.header).toEqual({ alg: "EdDSA", kid: `${did}#key-1` });
  expect(note.payload).toMatchObject({ iss: did, sub: did, aud: CLIENT });
  expect(note.payload.exp - note.payload.iat).toBe(120);

  // The log: text/jsonl, verified by the library, first entry did:webvh:1.0 and portable.
  const { res, log } = await fetchLog(request, did);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("text/jsonl");
  expect(log).toHaveLength(1);
  expect(log[0].parameters.method).toBe("did:webvh:1.0");
  expect(log[0].parameters.portable).toBe(true);
  const resolved = await verifyWithLibrary(log);
  expect(resolved.meta.error).toBeUndefined();
  expect(resolved.did).toBe(did);
  expect(resolved.doc.authentication).toEqual([`${did}#key-1`]);
  const key1 = resolved.doc.verificationMethod?.find((vm) => vm.id === `${did}#key-1`);
  expect(noteVerifies(note, key1?.publicKeyMultibase ?? "")).toBe(true);

  // A person row with that DID and SCID, holding the passkey.
  const rows = await withAdmin(async (db) =>
    (
      await db.query(
        `SELECT p.code, p.scid, p.email, p.email_verified_at, count(k.id)::int AS passkeys
           FROM identity.people p JOIN identity.passkeys k ON k.person_id = p.id
          WHERE p.did = $1 GROUP BY p.id`,
        [did],
      )
    ).rows,
  );
  expect(rows).toEqual([
    { code: codeOf(did), scid: resolved.meta.scid, email, email_verified_at: null, passkeys: 1 },
  ]);

  // The same passkey signs in again (discoverable: nothing typed) as the same DID.
  const again = await signIn(page);
  expect(callbackParams(again.url).note.payload.sub).toBe(did);
});

test.describe("check 12: the authorize page", () => {
  test("rejects a redirect_uri that isn't an exact registered match", async ({ page }) => {
    const wrong = [
      authorizeUrl(opaque(), opaque(), `${CALLBACK}/`),
      authorizeUrl(opaque(), opaque(), `${CALLBACK}?next=/`),
      authorizeUrl(opaque(), opaque(), `${CLIENT}/api/auth/other`),
      authorizeUrl(opaque(), opaque(), CALLBACK.replace("localhost", "127.0.0.1")),
      authorizeUrl(opaque(), opaque(), "https://evil.example/api/auth/callback"),
      authorizeUrl(opaque(), opaque(), CALLBACK, "https://evil.example"),
      authorizeUrl(opaque(), opaque(), CALLBACK.toUpperCase()),
    ];
    for (const url of wrong) {
      const res = await page.goto(url);
      expect(res?.status(), url).toBe(400);
      expect(new URL(page.url()).origin).toBe(identityURL);
      await expect(page.getByRole("heading", { name: "This sign-in link isn't valid" })).toBeVisible();
      await expect(page.getByRole("button", { name: /passkey/ })).toHaveCount(0);
    }
    const ok = await page.goto(authorizeUrl());
    expect(ok?.status()).toBe(200);
  });

  test("rejects an assertion whose challenge isn't the stored request's", async ({ page, request }) => {
    await addAuthenticator(page);
    await signUpAndContinue(page, testEmail("check12"));

    // Two authorize requests, A and B. An assertion over A's challenge is refused for B.
    await page.goto(authorizeUrl());
    const a = await page.locator("#signin").getAttribute("data-request");
    await page.goto(authorizeUrl());
    const b = await page.locator("#signin").getAttribute("data-request");
    expect(a).not.toBe(b);

    const outcome = await page.evaluate(
      async ({ a, b }) => {
        const toB64 = (buf: ArrayBuffer) =>
          btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
        const fromB64 = (s: string) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
        const post = async (path: string, body: unknown) => {
          const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          return { status: res.status, body: await res.json() };
        };
        const { body } = await post("/authorize/signin/options", { request: a });
        const cred = (await navigator.credentials.get({
          publicKey: {
            challenge: fromB64(body.options.challenge),
            rpId: body.options.rpId,
            allowCredentials: [],
            userVerification: "required",
          },
        })) as PublicKeyCredential;
        const r = cred.response as AuthenticatorAssertionResponse;
        const response = {
          id: cred.id,
          rawId: toB64(cred.rawId),
          type: cred.type,
          clientExtensionResults: {},
          response: {
            clientDataJSON: toB64(r.clientDataJSON),
            authenticatorData: toB64(r.authenticatorData),
            signature: toB64(r.signature),
            userHandle: r.userHandle ? toB64(r.userHandle) : undefined,
          },
        };
        const forB = await post("/authorize/signin/verify", { request: b, response });
        const forA = await post("/authorize/signin/verify", { request: a, response });
        return { forB, forA };
      },
      { a, b },
    );
    expect(outcome.forB.status).toBe(400);
    expect(outcome.forB.body.error).toBe("passkey_failed");
    // The same assertion is good for the request it was made for, so the refusal was the challenge.
    expect(outcome.forA.status).toBe(200);
    expect(outcome.forA.body.redirect).toMatch(new RegExp(`^${CALLBACK}\\?state=`));

    // B was not used up by the failed attempt, and A can't be used twice.
    const used = await withAdmin(async (db) =>
      (await db.query("SELECT id, used_at IS NOT NULL AS used FROM identity.auth_requests WHERE id = ANY($1) ORDER BY id", [[a, b]])).rows,
    );
    expect(Object.fromEntries(used.map((r) => [r.id, r.used]))).toEqual({ [a as string]: true, [b as string]: false });
    void request;
  });
});

test("check 28: no private key in keys.private_key_ciphertext or in any identity response", async ({ page, request }) => {
  const bodies: string[] = [];
  page.on("response", async (res) => {
    if (!res.url().startsWith(identityURL)) return;
    try {
      bodies.push(await res.text());
    } catch {
      // Redirects have no body.
    }
  });
  await addAuthenticator(page);
  const { did } = await signUpAndContinue(page, testEmail("check28"));
  await signIn(page);
  const { text: logText } = await fetchLog(request, did);
  bodies.push(logText);

  const keys = await withAdmin(async (db) =>
    (
      await db.query(
        "SELECT k.private_key_ciphertext, k.wrapped_dek, k.public_jwk FROM identity.keys k JOIN identity.people p ON p.id = k.person_id WHERE p.did = $1",
        [did],
      )
    ).rows as Array<{ private_key_ciphertext: Buffer; wrapped_dek: Buffer; public_jwk: Record<string, string> }>,
  );
  expect(keys).toHaveLength(1);
  const { private_key_ciphertext: ciphertext, wrapped_dek: wrapped, public_jwk: jwk } = keys[0];
  expect(Object.keys(jwk).sort()).toEqual(["crv", "kty", "x"]);
  // Ed25519 PKCS#8 always starts with this header; it must not appear anywhere in the stored bytes.
  const pkcs8Header = Buffer.from("302e020100300506032b657004220420", "hex");
  for (const blob of [ciphertext, wrapped]) {
    expect(blob.includes(pkcs8Header)).toBe(false);
    for (const attempt of [
      () => createPrivateKey({ key: blob, format: "der", type: "pkcs8" }),
      () => createPrivateKey({ key: blob, format: "der", type: "sec1" }),
      () => createPrivateKey({ key: blob, format: "der", type: "pkcs1" }),
      () => createPrivateKey(blob.toString("utf8")),
      () => createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: blob.subarray(-32).toString("base64url"), x: jwk.x }, format: "jwk" }),
    ]) {
      // The last attempt parses any 32 bytes; a real key would reproduce the public half.
      let derivedX: string | undefined;
      try {
        const key = attempt();
        derivedX = key.export({ format: "jwk" }).x;
      } catch {
        derivedX = undefined;
      }
      expect(derivedX === jwk.x).toBe(false);
    }
  }

  // Nothing the identity host sent carries private key material.
  expect(bodies.length).toBeGreaterThan(5);
  const all = bodies.join("\n");
  for (const marker of ["PRIVATE KEY", '"d":', "secretKeyMultibase", "private_key", "wrapped_dek", ciphertext.toString("base64"), ciphertext.toString("hex")]) {
    expect(all.includes(marker), marker).toBe(false);
  }
});

test("check 35: sign-up needs a valid email; its link verifies once, and not after 24 hours", async ({ page, request }) => {
  await addAuthenticator(page);

  // A missing or invalid address is refused before any passkey or person is made.
  await page.goto(authorizeUrl());
  for (const bad of ["", "not-an-email", "a@b", "x@@example.test", "x y@example.test"]) {
    await page.getByLabel("Email address").fill(bad);
    await page.getByRole("button", { name: "Create a passkey" }).click();
    await expect(page.getByRole("status")).toHaveText("Enter a valid email address.");
  }
  const after = await withAdmin(async (db) => (await db.query("SELECT count(*)::int AS n FROM identity.people WHERE email IN ('not-an-email', 'a@b')")).rows[0].n);
  expect(after).toBe(0);

  // A valid one works at once; the link confirms it once.
  const email = testEmail("check35");
  const { did } = await signUpAndContinue(page, email);
  const link = await verifyEmail(page, request, email);
  const verified = await withAdmin(async (db) => (await db.query("SELECT email_verified_at FROM identity.people WHERE did = $1", [did])).rows[0]);
  expect(verified.email_verified_at).not.toBeNull();
  const again = await page.goto(link);
  expect(again?.status()).toBe(410);
  await expect(page.getByText("This link has expired or was already used.")).toBeVisible();

  // Another person's link, opened 24 hours later, fails (the identity clock is moved forward).
  const late = testEmail("check35late");
  await signUpAndContinue(page, late);
  const [message] = (await mailbox(request, late)).filter((m) => m.kind === "verify_email");
  await setClock(request, 24 * HOUR + 60_000);
  const expired = await page.goto(linkIn(message));
  expect(expired?.status()).toBe(410);
  // And a form posted from a page opened just in time fails too.
  await setClock(request, 24 * HOUR - 60_000);
  await page.goto(linkIn(message));
  await setClock(request, 24 * HOUR + 60_000);
  await page.getByRole("button", { name: "Confirm my address" }).click();
  await expect(page.getByText("This link has expired or was already used.")).toBeVisible();
  const lateRow = await withAdmin(async (db) => (await db.query("SELECT email_verified_at FROM identity.people WHERE email = $1", [late])).rows[0]);
  expect(lateRow.email_verified_at).toBeNull();
});

test("check 36: an emailed link adds a new passkey to the same person and DID", async ({ page, request }) => {
  let auth = await addAuthenticator(page);
  const email = testEmail("check36");
  const { did } = await signUpAndContinue(page, email);
  await verifyEmail(page, request, email);
  const [original] = await credentials(auth);

  // The device is lost: a new authenticator with no passkey on it.
  await removeAuthenticator(auth);
  auth = await addAuthenticator(page);

  // "Lost your passkey?" from the authorize page, then the same answer for an unknown address.
  await catchCallback(page);
  const state = opaque();
  const nonce = opaque();
  await page.goto(authorizeUrl(state, nonce));
  await page.getByRole("link", { name: "Lost your passkey?" }).click();
  const unknown = testEmail("nobody");
  await page.getByLabel("Email address").fill(unknown);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByRole("status")).toHaveText("If that address has an account, we sent a link.");
  expect(await mailbox(request, unknown)).toEqual([]);

  await page.getByLabel("Email address").fill(email.toUpperCase());
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByRole("status")).toHaveText("If that address has an account, we sent a link.");
  const [recover] = (await mailbox(request, email)).filter((m) => m.kind === "recover");
  const link = linkIn(recover);
  expect(link).toMatch(/\/recover\/link\?token=[A-Za-z0-9_-]{43}$/);

  // The link registers the new authenticator's passkey and finishes the sign-in it started.
  await page.goto(link);
  await page.getByRole("button", { name: "Create a new passkey" }).click();
  await page.waitForURL(`${CALLBACK}?**`);
  const { note, state: returned } = callbackParams(page.url());
  expect(returned).toBe(state);
  expect(note.payload).toMatchObject({ sub: did, nonce });
  const [added] = await credentials(auth);
  expect(added.credentialId).not.toBe(original.credentialId);
  expect(added.userHandle).toBe(original.userHandle);

  // Same person and DID: two passkeys now, one person with this address, and a notice was sent.
  const person = await withAdmin(async (db) =>
    (
      await db.query(
        `SELECT p.did, count(k.id)::int AS passkeys,
                (SELECT count(*)::int FROM identity.audit_log a WHERE a.person_id = p.id AND a.action = 'recovered') AS recoveries
           FROM identity.people p JOIN identity.passkeys k ON k.person_id = p.id WHERE p.email = $1 GROUP BY p.id`,
        [email],
      )
    ).rows,
  );
  expect(person).toEqual([{ did, passkeys: 2, recoveries: 1 }]);
  expect((await mailbox(request, email)).map((m) => m.kind)).toContain("recovery_notice");

  // The new passkey signs in as the same DID.
  expect(callbackParams((await signIn(page)).url).note.payload.sub).toBe(did);

  // A used link fails.
  expect((await page.goto(link))?.status()).toBe(410);

  // An expired link fails: a new one, opened 16 minutes later.
  await page.goto(`${identityURL}/recover`);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  const links = (await mailbox(request, email)).filter((m) => m.kind === "recover").map(linkIn);
  expect(links).toHaveLength(2);
  await setClock(request, 16 * 60_000);
  expect((await page.goto(links[1]))?.status()).toBe(410);

  // The River's database holds no email address: none of these, in any river table.
  const found = await withAdmin(async (db) => {
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'river'")).rows.map((r) => r.tablename as string);
    expect(tables.length).toBeGreaterThan(5);
    let hits = 0;
    for (const table of tables) {
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM river.${table} t WHERE t::text ILIKE '%@example.test%' OR t::text ILIKE $1`,
        [`%${email}%`],
      );
      hits += rows[0].n;
    }
    return hits;
  });
  expect(found).toBe(0);
});

test("check 37: recover-dids re-keys a DID with the recovery key; same SCID, same passkey", async ({ page, request }) => {
  const recovery = testRecoveryKey();
  await addAuthenticator(page);
  const { did, note: firstNote } = await signUpAndContinue(page, testEmail("check37"));

  const before = await fetchLog(request, did);
  expect(before.log[0].parameters.updateKeys).toHaveLength(2);
  const personKey = before.log[0].state.verificationMethod?.[0].publicKeyMultibase;
  expect(before.log[0].parameters.updateKeys).toEqual([personKey, recovery.multikey]);
  expect(noteVerifies(firstNote, personKey ?? "")).toBe(true);
  const scid = before.log[0].parameters.scid;

  // Adam's command, with the run's throwaway recovery key and the identity host's settings.
  const run = spawnSync(
    "npx",
    ["tsx", "--env-file=.env.identity", "scripts/recover-dids.ts", "--key-file", recovery.file, "--code", codeOf(did)],
    { encoding: "utf8", timeout: 60_000 },
  );
  expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
  expect(run.stdout).toContain(`${codeOf(did)}: ${did} now at version 2`);

  const after = await fetchLog(request, did);
  expect(after.log).toHaveLength(2);
  expect(after.text.startsWith(before.text)).toBe(true);
  const entry = after.log[1];
  expect(entry.proof?.[0].verificationMethod).toBe(`did:key:${recovery.multikey}#${recovery.multikey}`);
  const resolved = await verifyWithLibrary(after.log);
  expect(resolved.meta.error).toBeUndefined();
  expect(resolved.meta.scid).toBe(scid);
  expect(resolved.did).toBe(did);
  const newKey = resolved.doc.verificationMethod?.find((vm) => vm.id === `${did}#key-1`)?.publicKeyMultibase;
  expect(newKey).toBeDefined();
  expect(newKey).not.toBe(personKey);
  expect(resolved.meta.updateKeys).toEqual([newKey, recovery.multikey]);

  // Same passkey, same person and DID; the note is now signed by the new custodial key.
  const { note } = callbackParams((await signIn(page)).url);
  expect(note.payload.sub).toBe(did);
  expect(noteVerifies(note, newKey ?? "")).toBe(true);
  expect(noteVerifies(note, personKey ?? "")).toBe(false);
});

test("change email: a fresh passkey check, a link to the new address, a notice to the old", async ({ page, request }) => {
  await addAuthenticator(page);
  const old = testEmail("change-old");
  const { did } = await signUpAndContinue(page, old);
  await verifyEmail(page, request, old);

  const next = testEmail("change-new");
  await page.goto(`${identityURL}/account/email`);
  await page.getByLabel("New email address").fill(next);
  await page.getByRole("button", { name: "Confirm with your passkey" }).click();
  await expect(page.getByRole("status")).toContainText("We sent a link to c***@e***.test");
  expect((await mailbox(request, old)).map((m) => m.kind)).toContain("email_change_notice");

  // Still the old address until the new one is confirmed; then the new one, verified.
  const email = async () =>
    withAdmin(async (db) => (await db.query("SELECT email, email_verified_at FROM identity.people WHERE did = $1", [did])).rows[0]);
  expect((await email()).email).toBe(old);
  await verifyEmail(page, request, next);
  const changed = await email();
  expect(changed.email).toBe(next);
  expect(changed.email_verified_at).not.toBeNull();

  // Asking for the address it already has sends nothing.
  await page.goto(`${identityURL}/account/email`);
  await page.getByLabel("New email address").fill(next);
  await page.getByRole("button", { name: "Confirm with your passkey" }).click();
  await expect(page.getByRole("status")).toHaveText("That is already your address, and it is confirmed.");
  expect((await mailbox(request, next)).filter((m) => m.kind === "verify_email")).toHaveLength(1);
});

test("identity pages: the script runs under the CSP with no violation; axe finds nothing serious; Tab reaches every control", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  const pages = [
    { url: authorizeUrl(), script: true },
    { url: `${identityURL}/account/email`, script: true },
    { url: `${identityURL}/recover`, script: false },
    { url: `${identityURL}/`, script: false },
  ];
  for (const { url, script } of pages) {
    await page.goto(url);
    if (script) await expect(page.locator("html")).toHaveAttribute("data-passkey", "ready");
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(serious, url).toEqual([]);

    // Tab through the page: every visible link, input and button in <main> takes focus.
    const controls = await page.locator("main a:visible, main input:visible, main button:visible").count();
    expect(controls, url).toBeGreaterThan(0);
    const reached = new Set<string>();
    for (let i = 0; i < controls + 4; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || !el.closest("main")) return null;
        return `${el.tagName}|${el.id}|${el.getAttribute("href") ?? ""}|${el.textContent?.trim() ?? ""}`;
      });
      if (focused) reached.add(focused);
    }
    expect(reached.size, url).toBe(controls);
  }
  expect(violations).toEqual([]);
});
