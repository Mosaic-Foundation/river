// Shared steps for the fediverse e2e tests (Linked accounts, the composer): sign up, reset the
// SYNTHETIC stand-in server the dev server talks to (TEST_STAND_IN_FEDIVERSE=1) and the instance's
// app registrations there, approve on the stand-in's authorize page, link an account, run axe.
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import pg from "pg";
import { identityURL } from "../../playwright.config";
import { expect } from "./fixtures";
import { ADMIN_URL, addAuthenticator, riverAccount, testEmail, throughCallback } from "./identityHelpers";

export async function resetStandIn(request: APIRequestContext): Promise<void> {
  const reset = await request.post("/api/test/stand-in-fediverse/reset");
  expect(reset.status(), "start the dev server with TEST_STAND_IN_FEDIVERSE=1 (TESTING.md)").toBe(204);
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    // The stand-in forgot its apps; the instance forgets its registrations there too.
    await client.query("DELETE FROM river.oauth_clients WHERE host LIKE '%.stand-in.example'");
  } finally {
    await client.end();
  }
}

export async function signUp(page: Page, label: string): Promise<string> {
  await addAuthenticator(page);
  await page.goto("/");
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/api/auth/signin");
  await page.waitForURL(`${identityURL}/authorize?**`);
  await page.getByLabel("Email address").fill(testEmail(label));
  await page.getByRole("button", { name: "Create a passkey" }).click();
  await throughCallback(page, () => page.getByRole("link", { name: "Continue to Mosaic River" }).click());
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
  const account = await riverAccount(page.context());
  if (!account) throw new Error("no River session after sign-up");
  return account;
}

/** The stand-in servers' authorize pages: approve as `username` and send the browser back. */
export async function approveAs(page: Page, request: APIRequestContext, username: string): Promise<string[]> {
  const visited: string[] = [];
  await page.route(/^https:\/\/[a-z0-9-]+\.stand-in\.example\/oauth\/authorize/, async (route) => {
    visited.push(route.request().url());
    const res = await request.post("/api/test/stand-in-fediverse/authorize", { data: { url: route.request().url(), username } });
    const { location, error } = (await res.json()) as { location?: string; error?: string };
    if (!location) throw new Error(`stand-in refused: ${error}`);
    await route.fulfill({ status: 302, headers: { location } });
  });
  return visited;
}

/** Links `handle` from the Linked accounts page, approving as `username`. */
export async function linkFromPage(page: Page, request: APIRequestContext, handle: string, username: string): Promise<void> {
  await approveAs(page, request, username);
  await page.goto("/linked-accounts");
  await page.getByLabel("Your handle or profile address").fill(handle);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: /^Continue to / }).click();
  await page.waitForURL(/\/linked-accounts$/, { timeout: 30_000 });
  await expect(page.getByTestId("link-notice")).toHaveText("Your account is linked.");
}

export async function seriousAxe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}
