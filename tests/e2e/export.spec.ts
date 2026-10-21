import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { identityURL } from "../../playwright.config";
import { expect, test } from "./fixtures";
import { addAuthenticator, callbackParams, resetLimits, setClock, testEmail, throughCallback } from "./identityHelpers";

// M11, the member export (spec 3.3, check 29). A real member signs up through the River's Sign up,
// the identity host's passkey page (Chromium's virtual authenticator) and the River's callback,
// then downloads `GET /api/me/export` as the browser would and fetches it from the page. A visitor
// gets 401. The address the member signed up with never appears: the River never receives it.

test.beforeEach(async ({ request }) => {
  await resetLimits(request);
  await setClock(request, 0);
});

interface Export {
  format: string;
  version: number;
  exported_at: string;
  did: string | null;
  follows: Array<{ url: string; stream_key: string | null; rule: string; circles: string[] }>;
  circles: Array<{ name: string; color: string | null; role: string | null }>;
  preferences: Record<string, unknown>;
}

/** Signs up from the River; returns the DID the note named and the address used. */
async function signUp(page: Page, label: string): Promise<{ did: string; email: string }> {
  const email = testEmail(label);
  await addAuthenticator(page);
  await page.goto("/");
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/api/auth/signin");
  await page.waitForURL(`${identityURL}/authorize?**`);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Create a passkey" }).click();
  const callback = await throughCallback(page, () => page.getByRole("link", { name: "Continue to Mosaic River" }).click());
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
  return { did: callbackParams(callback).note.payload.iss, email };
}

function checkShape(doc: Export, did: string): void {
  expect(Object.keys(doc).sort()).toEqual(["circles", "did", "exported_at", "follows", "format", "preferences", "version"]);
  expect(doc.format).toBe("mosaic-river-export");
  expect(doc.version).toBe(1);
  expect(Number.isNaN(Date.parse(doc.exported_at))).toBe(false);
  expect(doc.did).toBe(did);
  expect(doc.preferences).toEqual({});
  expect(doc.circles).toContainEqual({ name: "Civic", color: "#2F6FA8", role: "civic" });
  expect(doc.follows).toContainEqual({ url: "https://demosville.civic.social", stream_key: null, rule: "follow", circles: ["Civic"] });
  for (const f of doc.follows) expect(Object.keys(f).sort()).toEqual(["circles", "rule", "stream_key", "url"]);
}

test("check 29: a member downloads the export in spec 3.3's shape; a visitor gets 401", async ({ page, request }) => {
  const { did, email } = await signUp(page, "export");
  expect(did).toMatch(/^did:webvh:/);

  // As a download, the way a link to it would work.
  const downloading = page.waitForEvent("download");
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "/api/me/export";
    document.body.append(a);
    a.click();
    a.remove();
  });
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("mosaic-river-export.json");
  const text = await readFile((await download.path()) ?? "", "utf8");
  const doc = JSON.parse(text) as Export;
  checkShape(doc, did);
  expect(text).not.toContain(email);
  expect(text).not.toMatch(/email|PRIVATE KEY|private_key/i);

  // Fetched from the page, after a change on the Following page's API: a new circle shows.
  const made = await page.evaluate(async () => {
    const res = await fetch("/api/circles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Book club", color: "#336699" }),
    });
    return res.status;
  });
  expect(made).toBe(201);
  const fetched = await page.evaluate(async () => {
    const res = await fetch("/api/me/export");
    return { status: res.status, body: (await res.json()) as unknown };
  });
  expect(fetched.status).toBe(200);
  checkShape(fetched.body as Export, did);
  expect((fetched.body as Export).circles).toContainEqual({ name: "Book club", color: "#336699", role: null });

  // A visitor (no session cookie) is refused.
  const refused = await request.get("/api/me/export");
  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: "sign_in_required", message: "Sign in to do that." });
});
