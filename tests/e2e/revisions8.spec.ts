import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 8 (docs/spec/ui-revisions-8.md): Coming up back in Everything's right-hand column,
// the circles as wrapping pills (revisions4.spec.ts item 2), and the whole window: the filter
// column against the left edge, Coming up against the right, the feed centred between.

async function openFeed(page: Page, width: number, height = 1000, path = "/"): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(path);
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
}

/** The page's width: the window less the scrollbar gutter the page keeps. */
function pageWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.body.getBoundingClientRect().width);
}

test.describe("item 1: Coming up is back in Everything", () => {
  test("Everything shows the Coming up column at desktop width, with its dates", async ({ page }) => {
    await openFeed(page, 1440);
    const comingUp = page.getByTestId("plugin-coming-up");
    await expect(comingUp).toBeVisible();
    await expect(comingUp.getByRole("heading", { name: "Coming up" })).toBeVisible();
    await expect(comingUp.getByTestId("coming-up-entry").first()).toBeVisible();
  });
});

test.describe("item 3: the whole window", () => {
  for (const width of [1920, 1440]) {
    test(`at ${width}px the columns meet the window's edges and the feed sits between them`, async ({ page }) => {
      await openFeed(page, width);
      const right = await pageWidth(page);
      // The sidebar itself (its column adds padding for the shadow).
      const filters = await box(page.getByRole("complementary", { name: "Filters" }));
      const comingUp = await box(page.locator(".plugin-column"));
      const feed = await box(page.locator("main.feed"));
      const gutter = 16; // --space-md

      // The filter column against the left edge, Coming up against the right, like Facebook.
      expect(filters.x).toBeLessThanOrEqual(gutter);
      expect(right - (comingUp.x + comingUp.width)).toBeLessThanOrEqual(gutter);
      // The feed between them, centred in the space they leave, at its reading width.
      const left = filters.x + filters.width;
      const spaceLeft = feed.x - left;
      const spaceRight = comingUp.x - (feed.x + feed.width);
      expect(Math.abs(spaceLeft - spaceRight)).toBeLessThanOrEqual(2);
      expect(feed.width).toBeLessThanOrEqual(44 * 16 + 1); // --layout-feed
      // Nothing scrolls sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }

  test("between 56rem and 80rem the filters stay on the left edge and Coming up sits above the feed", async ({ page }) => {
    await openFeed(page, 1100, 800);
    const filters = await box(page.getByRole("complementary", { name: "Filters" }));
    const comingUp = await box(page.locator(".plugin-column"));
    const feed = await box(page.locator("main.feed"));
    expect(filters.x).toBeLessThanOrEqual(16);
    expect(comingUp.y + comingUp.height).toBeLessThanOrEqual(feed.y);
    expect(Math.round(comingUp.x)).toBe(Math.round(feed.x));
  });

  test("the top bar spans the window too: the brand at the left edge, the actions at the right", async ({ page }) => {
    await openFeed(page, 1920);
    const right = await pageWidth(page);
    const brand = await box(page.locator(".topbar .brand"));
    const follow = await box(page.getByRole("button", { name: "Follow", exact: true }));
    expect(brand.x).toBeLessThanOrEqual(16);
    expect(right - (follow.x + follow.width)).toBeLessThanOrEqual(16);
  });
});
