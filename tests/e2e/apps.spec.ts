import { expect, test } from "./fixtures";
import { identityURL } from "../../playwright.config";

// M0: both deployables answer /health and name themselves (ADR-006).
test("the River API answers /health through the UI's /api path", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, app: "river" });
});

test("the identity host answers /health on its own port", async ({ request }) => {
  const res = await request.get(`${identityURL}/health`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, app: "identity" });
});

test("the identity host serves its page and the bundled passkey script", async ({ page }) => {
  await page.goto(`${identityURL}/`);
  await expect(page.getByRole("heading", { level: 1, name: "Mosaic ID" })).toBeVisible();
  const script = await page.request.get(`${identityURL}/passkey.js`);
  expect(script.status()).toBe(200);
  expect(script.headers()["content-type"]).toMatch(/javascript/);
});
