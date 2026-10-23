import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 3 (docs/spec/ui-revisions-3.md), item 5: "Clear all" at the top of the filter
// column. The API replays recorded responses; nothing leaves loopback (fixtures.ts).

async function openFeed(page: Page, path = "/"): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(path);
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
}

test.describe("item 5: Clear all in the filter column", () => {
  test("hidden with no filter on; below search with filters on; one click clears search, circle, types and networks", async ({ page }) => {
    await openFeed(page);
    const sidebar = page.getByRole("complementary", { name: "Filters" });
    const clear = sidebar.getByRole("button", { name: "Clear all" });
    await expect(clear).toHaveCount(0);

    await sidebar.getByRole("navigation", { name: "Circles" }).getByRole("button", { name: "Civic" }).click();
    await expect(clear).toBeVisible();
    await sidebar.getByRole("navigation", { name: "Content type" }).getByRole("button", { name: "Civic activity" }).click();
    await sidebar.getByRole("navigation", { name: "Networks" }).getByRole("button", { name: "Civic Hubs" }).click();
    const search = sidebar.getByRole("searchbox", { name: "Search your River" });
    await search.fill("vote");
    await search.press("Enter");
    await expect(page).toHaveURL(/circle=.+&type=civic&network=hubs&q=vote$/);

    // Just below the search field, above the first section.
    const searchBox = (await search.boundingBox())!;
    const clearBox = (await clear.boundingBox())!;
    const circlesBox = (await sidebar.getByRole("navigation", { name: "Circles" }).boundingBox())!;
    expect(clearBox.y).toBeGreaterThan(searchBox.y + searchBox.height);
    expect(clearBox.y + clearBox.height).toBeLessThan(circlesBox.y);
    // The title, search, then Clear all (ui-revisions-4 item 3).
    expect(await sidebar.evaluate((el) => el.children[2]?.getAttribute("data-testid"))).toBe("sidebar-clear");

    await clear.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(sidebar.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(sidebar.locator("[aria-pressed=true]")).toHaveCount(1);
    await expect(page.getByTestId("active-filters")).toHaveCount(0);
    await expect(clear).toHaveCount(0);
  });

  test("the mode stays; a single search alone shows it, and it works from the keyboard", async ({ page }) => {
    await openFeed(page, "/?mode=civic&q=meeting");
    const sidebar = page.getByRole("complementary", { name: "Filters" });
    const clear = sidebar.getByRole("button", { name: "Clear all" });
    await expect(clear).toBeVisible();
    await clear.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/\?mode=civic$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "civic");
    await expect(clear).toHaveCount(0);
  });
});
