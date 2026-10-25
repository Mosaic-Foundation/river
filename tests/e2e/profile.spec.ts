import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { identityURL } from "../../playwright.config";
import { expect, test } from "./fixtures";
import { addAuthenticator, callbackParams, resetLimits, setClock, testEmail, throughCallback } from "./identityHelpers";

// UI revisions 9 (docs/spec/ui-revisions-9.md): the profile menu at the top right (My information
// with the member's DID, Settings, Sign out), the DID off the top bar, and dark mode.

test.beforeEach(async ({ request }) => {
  await resetLimits(request);
  await setClock(request, 0);
});

async function openFeed(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
}

/** Signs up through the River; returns the member's DID. */
async function signUp(page: Page, label: string): Promise<string> {
  await addAuthenticator(page);
  await openFeed(page);
  await page.goto("/api/auth/signin");
  await page.waitForURL(`${identityURL}/authorize?**`);
  await page.getByLabel("Email address").fill(testEmail(label));
  await page.getByRole("button", { name: "Create a passkey" }).click();
  const url = await throughCallback(page, () => page.getByRole("link", { name: "Continue to Mosaic River" }).click());
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
  return callbackParams(url).note.payload.sub;
}

async function seriousAxe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

function scheme(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.scheme);
}

function background(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test.describe("item 1: the profile menu", () => {
  test("a member's menu: My information explains DIDs and shows theirs; the DID is off the top bar", async ({ page }) => {
    const did = await signUp(page, "profile-info");
    const bar = page.locator(".topbar");
    await expect(bar).not.toContainText(did);
    await expect(bar).not.toContainText("did:");

    const button = bar.getByRole("button", { name: "Your profile and settings" });
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("menu", { name: "Your profile and settings" });
    await expect(menu.getByRole("menuitem")).toHaveText(["My information", "Following", "Settings", "Sign out"]);
    // The bar itself has no Following link any more (ui-revisions-11 item 1): Follow and the menu go there.
    await expect(bar.getByRole("link", { name: "Following", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "My information" })).toBeFocused();

    await menu.getByRole("menuitem", { name: "My information" }).click();
    const info = page.getByRole("dialog", { name: "My information" });
    await expect(info).toBeVisible();
    await expect(info).toContainText("decentralized identifier");
    await expect(info).toContainText("Your Mosaic DID");
    await expect(info.getByTestId("my-did")).toHaveText(did);
    expect(await seriousAxe(page)).toEqual([]);
    await info.getByRole("button", { name: "Done" }).click();
    await expect(info).toBeHidden();
    await expect(button).toBeFocused();

    // Sign out is in the menu now.
    await button.click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(bar.getByRole("link", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  });

  test("the Following page has the same menu: My information, Following, Settings, Sign out", async ({ page }) => {
    const did = await signUp(page, "profile-following");
    await page.goto("/following?mode=civic");
    await expect(page.getByRole("heading", { level: 1, name: "Following" })).toBeVisible({ timeout: 30_000 });
    const button = page.locator(".topbar").getByRole("button", { name: "Your profile and settings" });
    await button.click();
    const menu = page.getByRole("menu", { name: "Your profile and settings" });
    await expect(menu.getByRole("menuitem")).toHaveText(["My information", "Following", "Settings", "Sign out"]);
    await expect(menu.getByRole("menuitem", { name: "Following" })).toHaveAttribute("href", "/following?mode=civic");
    await menu.getByRole("menuitem", { name: "My information" }).click();
    await expect(page.getByTestId("my-did")).toHaveText(did);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(button).toBeFocused();
    expect(await seriousAxe(page)).toEqual([]);

    // Sign out from the Following page goes back to the River (in its mode) as a visitor.
    await button.click();
    await page.getByRole("menu", { name: "Your profile and settings" }).getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/\?mode=civic$/);
    await expect(page.getByTestId("sample-banner")).toBeVisible({ timeout: 30_000 });
  });

  test("a visitor on the Following page gets the visitor's menu", async ({ page }) => {
    await page.goto("/following");
    await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible({ timeout: 30_000 });
    await page.locator(".topbar").getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("menu", { name: "Settings" }).getByRole("menuitem")).toHaveText(["Settings", "Sign in"]);
  });

  test("a visitor's menu has Settings and Sign in, no My information", async ({ page }) => {
    await openFeed(page);
    const button = page.locator(".topbar").getByRole("button", { name: "Settings" });
    await button.click();
    const menu = page.getByRole("menu", { name: "Settings" });
    await expect(menu.getByRole("menuitem")).toHaveText(["Settings", "Sign in"]);
    await expect(menu.getByRole("menuitem", { name: "Sign in" })).toHaveAttribute("href", "/api/auth/signin");
  });

  test("works from the keyboard: open, arrow, Escape, focus back on the button", async ({ page }) => {
    await openFeed(page);
    const button = page.getByTestId("profile-button");
    await button.focus();
    await page.keyboard.press("Enter");
    const items = page.getByRole("menuitem");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.first()).toBeFocused(); // wraps
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("profile-menu")).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("on a phone the button sits in the top bar and the menu stays on screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFeed(page);
    const button = page.getByTestId("profile-button");
    await expect(button).toBeVisible();
    await button.click();
    const box = (await page.getByTestId("profile-menu").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe("item 2: dark mode", () => {
  test("Settings switches to dark and back; the choice survives a reload; AA in dark", async ({ page }) => {
    await openFeed(page);
    expect(await scheme(page)).toBe("light");
    const lightBg = await background(page);

    await page.getByTestId("profile-button").click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    const toggle = settings.getByRole("switch", { name: "Dark mode" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(await scheme(page)).toBe("dark");
    expect(await background(page)).not.toBe(lightBg);
    await settings.getByRole("button", { name: "Done" }).click();

    // Saved: a reload opens dark before React runs (public/color-scheme.js).
    await page.reload();
    expect(await scheme(page)).toBe("dark");
    await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
    expect(await seriousAxe(page)).toEqual([]);

    // Civic mode has its own dark.
    await openFeed(page, "/?mode=civic");
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("civic");
    expect(await scheme(page)).toBe("dark");
    expect(await seriousAxe(page)).toEqual([]);

    // And back to light.
    await page.getByTestId("profile-button").click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.getByRole("switch", { name: "Dark mode" }).click();
    expect(await scheme(page)).toBe("light");
    await page.reload();
    expect(await scheme(page)).toBe("light");
  });

  test("with no choice made, the River follows the device's setting", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await openFeed(page);
    expect(await scheme(page)).toBe("dark");
    await page.getByTestId("profile-button").click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page.getByRole("switch", { name: "Dark mode" })).toHaveAttribute("aria-checked", "true");
    await context.close();
  });
});
