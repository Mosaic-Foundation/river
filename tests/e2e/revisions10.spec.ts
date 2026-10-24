import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 10 (docs/spec/ui-revisions-10.md): one wide filter button under search in place of
// the column's title and Clear all, and gaps between the columns that narrow with the window
// before the layout drops a column. filterClear.spec.ts covers clearing.

async function openFeed(page: Page, width: number, path = "/"): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
}

function columnGap(page: Page): Promise<number> {
  return page.locator(".layout").evaluate((el) => parseFloat(getComputedStyle(el).columnGap));
}

test.describe("item 1: one wide filter button", () => {
  for (const mode of ["everything", "civic"]) {
    test(`it spans the column under search and turns to Clear the filter at the first filter (${mode})`, async ({ page }) => {
      await openFeed(page, 1440, mode === "civic" ? "/?mode=civic" : "/");
      const sidebar = page.getByRole("complementary", { name: "Filters" });
      const action = sidebar.getByTestId("sidebar-filter-action");
      await expect(action).toHaveText("Filter your River");
      // No title above search any more.
      await expect(sidebar.getByRole("heading", { level: 2 })).toHaveCount(0);
      await expect(sidebar.getByRole("button", { name: "Clear all" })).toHaveCount(0);

      // Wide: as wide as the search field, just under it.
      const search = (await sidebar.getByRole("searchbox").boundingBox())!;
      const button = (await action.boundingBox())!;
      expect(Math.abs(button.width - search.width)).toBeLessThanOrEqual(2);
      expect(button.y).toBeGreaterThan(search.y + search.height);

      // Any filter turns it.
      await sidebar.getByRole("navigation", { name: "Content type" }).getByRole("button", { name: "Articles" }).click();
      await expect(action).toHaveText("Clear the filter");
      await action.click();
      await expect(action).toHaveText("Filter your River");
      await sidebar.getByRole("navigation", { name: "Networks" }).getByRole("button", { name: "Civic Hubs" }).click();
      await expect(action).toHaveText("Clear the filter");
    });
  }
});

test.describe("item 2: the gaps narrow before a column goes", () => {
  test("three columns: full gaps at 1440 px, narrow ones just above the 80rem switch", async ({ page }) => {
    await openFeed(page, 1440);
    expect(await columnGap(page)).toBe(32);
    await page.setViewportSize({ width: 1310, height: 900 });
    const narrow = await columnGap(page);
    expect(narrow).toBeLessThan(16);
    expect(narrow).toBeGreaterThanOrEqual(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("two columns: full gaps mid-range, narrow ones just above the 56rem switch", async ({ page }) => {
    await openFeed(page, 1100);
    expect(await columnGap(page)).toBe(32);
    await page.setViewportSize({ width: 930, height: 900 });
    expect(await columnGap(page)).toBeLessThan(16);
  });
});
