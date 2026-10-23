import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { identityURL } from "../../playwright.config";
import { expect, test } from "./fixtures";
import { addAuthenticator, resetLimits, setClock, testEmail, throughCallback } from "./identityHelpers";

// A circles menu on each Following row (docs/spec/ui-revisions-7.md): add to and remove from a
// circle, undo on a refused save, "New circle…", the keyboard, and the phone's bottom sheet. Every
// member is real (signed up with Chromium's virtual authenticator); hubs are recorded responses.

const HUB = "Demosville Civic Hub";

test.beforeEach(async ({ request }) => {
  await resetLimits(request);
  await setClock(request, 0);
});

async function signUp(page: Page, label: string): Promise<void> {
  await addAuthenticator(page);
  await page.goto("/");
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/api/auth/signin");
  await page.waitForURL(`${identityURL}/authorize?**`);
  await page.getByLabel("Email address").fill(testEmail(label));
  await page.getByRole("button", { name: "Create a passkey" }).click();
  await throughCallback(page, () => page.getByRole("link", { name: "Continue to Mosaic River" }).click());
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
}

async function openFollowing(page: Page): Promise<void> {
  await page.goto("/following");
  await expect(page.getByTestId("space-row").first()).toBeVisible({ timeout: 30_000 });
}

function spaceRow(page: Page, name: string): Locator {
  return page.getByTestId("space-row").filter({ has: page.locator(".space-row-name", { hasText: name }) });
}

function circlesButton(page: Page, name = HUB): Locator {
  return spaceRow(page, name).getByRole("button", { name: `Circles for ${name}:` });
}

function menu(page: Page, name = HUB): Locator {
  return page.getByRole("menu", { name: `Circles for ${name}` });
}

interface Circle {
  id: string;
  name: string;
  spaceIds: string[];
}

/** The member's circles and the hub row's space id, from the API. */
async function circlesOf(page: Page, name = HUB): Promise<{ circles: Circle[]; spaceId: string }> {
  return page.evaluate(async (spaceName) => {
    const body = (await (await fetch("/api/following")).json()) as {
      circles: Circle[];
      spaces: Array<{ id: string; name: string }>;
    };
    return { circles: body.circles, spaceId: body.spaces.find((s) => s.name === spaceName)!.id };
  }, name);
}

/** A circle the hub isn't in yet. */
async function circleWithout(page: Page): Promise<string> {
  const { circles, spaceId } = await circlesOf(page);
  const circle = circles.find((c) => !c.spaceIds.includes(spaceId));
  expect(circle, "a circle the hub isn't in").toBeTruthy();
  return circle!.name;
}

async function expectNoSeriousAxeIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(serious).toEqual([]);
}

test("item 1: add the row to a circle and remove it; every circle is listed with the row's checked", async ({ page }) => {
  await signUp(page, "circlesmenu-add");
  await openFollowing(page);
  const target = await circleWithout(page);
  const { circles, spaceId } = await circlesOf(page);

  const button = circlesButton(page);
  await expect(button).toHaveAttribute("aria-haspopup", "menu");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).not.toContainText(target);
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");

  // Every circle, the row's checked.
  const items = menu(page).getByRole("menuitemcheckbox");
  await expect(items).toHaveText(circles.map((c) => c.name));
  for (const c of circles) {
    await expect(menu(page).getByRole("menuitemcheckbox", { name: c.name, exact: true })).toHaveAttribute(
      "aria-checked",
      String(c.spaceIds.includes(spaceId)),
    );
  }
  await expect(menu(page).getByRole("menuitem", { name: "New circle…" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);

  // Add: the item and the row change, and it's saved.
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/circles\/[^/]+\/spaces\//.test(r.url()));
  await menu(page).getByRole("menuitemcheckbox", { name: target, exact: true }).click();
  await expect(menu(page).getByRole("menuitemcheckbox", { name: target, exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(button).toContainText(target);
  expect((await saved).status()).toBe(204);

  // Done closes it and focus goes back to the button.
  await page.getByRole("button", { name: "Done" }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  await expect(circlesButton(page)).toContainText(target, { timeout: 30_000 });
  expect((await circlesOf(page)).circles.find((c) => c.name === target)!.spaceIds).toContain(spaceId);
  // The Circles panel counts it too.
  await expect(page.getByRole("complementary", { name: "Circles" }).getByTestId("circle-row").filter({ hasText: target })).toContainText(
    /\d+ spaces?/,
  );

  // Remove.
  await circlesButton(page).click();
  const removed = page.waitForResponse((r) => r.request().method() === "DELETE" && /\/api\/circles\/[^/]+\/spaces\//.test(r.url()));
  await menu(page).getByRole("menuitemcheckbox", { name: target, exact: true }).click();
  await expect(menu(page).getByRole("menuitemcheckbox", { name: target, exact: true })).toHaveAttribute("aria-checked", "false");
  await expect(circlesButton(page)).not.toContainText(target);
  expect((await removed).status()).toBe(204);
  await page.reload();
  await expect(circlesButton(page)).toBeVisible({ timeout: 30_000 });
  await expect(circlesButton(page)).not.toContainText(target);
  expect((await circlesOf(page)).circles.find((c) => c.name === target)!.spaceIds).not.toContain(spaceId);
});

test("item 2: the row changes before the save returns, and a refused save is undone with its error", async ({ page }) => {
  await signUp(page, "circlesmenu-undo");
  await openFollowing(page);
  const target = await circleWithout(page);

  // Hold the save until the row has changed, then refuse it.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/circles\/[^/]+\/spaces\//, async (route) => {
    await held;
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ message: "That circle is full." }) });
  });

  await circlesButton(page).click();
  const item = menu(page).getByRole("menuitemcheckbox", { name: target, exact: true });
  await item.click();
  await expect(item).toHaveAttribute("aria-checked", "true");
  await expect(circlesButton(page)).toContainText(target);
  release();
  await expect(item).toHaveAttribute("aria-checked", "false");
  await expect(circlesButton(page)).not.toContainText(target);
  await expect(page.getByRole("alert").filter({ hasText: "That circle is full." })).toBeVisible();
  await page.unroute(/\/api\/circles\/[^/]+\/spaces\//);

  // Escape closes it, focus back on the button; a click outside closes it too.
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(circlesButton(page)).toBeFocused();
  await circlesButton(page).click();
  await expect(menu(page)).toBeVisible();
  await page.getByRole("heading", { level: 1, name: "Following" }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(circlesButton(page)).toHaveAttribute("aria-expanded", "false");
});

test("item 1: New circle… creates a circle with the row in it", async ({ page }) => {
  await signUp(page, "circlesmenu-new");
  await openFollowing(page);
  const { spaceId } = await circlesOf(page);

  await circlesButton(page).click();
  await menu(page).getByRole("menuitem", { name: "New circle…" }).click();
  await expect(page.getByLabel("New circle name")).toBeFocused();
  await page.getByLabel("New circle name").fill("Book club");
  await page.getByRole("button", { name: "Create and add" }).click();

  await expect(menu(page).getByRole("menuitemcheckbox", { name: "Book club" })).toHaveAttribute("aria-checked", "true");
  await expect(menu(page).getByRole("menuitemcheckbox", { name: "Book club" })).toBeFocused();
  await expect(circlesButton(page)).toContainText("Book club");
  await expect(
    page.getByRole("complementary", { name: "Circles" }).getByTestId("circle-row").filter({ hasText: "Book club" }),
  ).toContainText("1 space");
  const book = (await circlesOf(page)).circles.find((c) => c.name === "Book club");
  expect(book?.spaceIds).toEqual([spaceId]);

  // A taken name is refused, and says so.
  await menu(page).getByRole("menuitem", { name: "New circle…" }).click();
  await page.getByLabel("New circle name").fill("Book club");
  await page.getByRole("button", { name: "Create and add" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "You already have a circle with that name." })).toBeVisible();
});

test("item 3: keyboard only — open, move, toggle, close; focus returns to the button", async ({ page }) => {
  await signUp(page, "circlesmenu-keys");
  await openFollowing(page);
  const { circles, spaceId } = await circlesOf(page);

  const button = circlesButton(page);
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeVisible();
  // Focus starts on the first circle the row is in, else the first.
  const start = Math.max(0, circles.findIndex((c) => c.spaceIds.includes(spaceId)));
  const items = menu(page).getByRole("menuitemcheckbox");
  await expect(items.nth(start)).toBeFocused();

  // Home, then down to the next one, and toggle it with Space.
  await page.keyboard.press("Home");
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  const second = circles[1]!;
  const was = second.spaceIds.includes(spaceId);
  await page.keyboard.press("Space");
  await expect(items.nth(1)).toHaveAttribute("aria-checked", String(!was));
  // Up from the first wraps to the last item ("New circle…").
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(menu(page).getByRole("menuitem", { name: "New circle…" })).toBeFocused();
  // Enter toggles too.
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(items.nth(1)).toHaveAttribute("aria-checked", String(was));

  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect.poll(async () => (await circlesOf(page)).circles[1]!.spaceIds.includes(spaceId)).toBe(was);
});

test("item 3 on a phone: the menu is a small bottom sheet; toggling works; a tap outside closes it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, "circlesmenu-phone");
  await openFollowing(page);
  const target = await circleWithout(page);

  await circlesButton(page).click();
  const sheet = page.getByTestId("circles-menu");
  await expect(sheet).toBeVisible();
  // Measure once it has slid in.
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const box = (await sheet.boundingBox())!;
  // Full width: the page's width (the viewport less the scrollbar gutter the page keeps).
  expect(box.x).toBe(0);
  expect(box.width).toBe(await page.evaluate(() => document.body.getBoundingClientRect().width));
  expect(Math.round(box.y + box.height)).toBe(844);
  expect(box.height).toBeLessThan(844 * 0.75);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(await sheet.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await expectNoSeriousAxeIssues(page);

  await menu(page).getByRole("menuitemcheckbox", { name: target, exact: true }).click();
  await expect(menu(page).getByRole("menuitemcheckbox", { name: target, exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(circlesButton(page)).toContainText(target);

  // A tap on the backdrop above the sheet closes it.
  await page.mouse.click(195, 40);
  await expect(menu(page)).toHaveCount(0);
  await expect(circlesButton(page)).toBeFocused();
});
