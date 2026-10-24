import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Clearing the filter column (ui-revisions-3 item 5, now ui-revisions-10 item 1): one wide button
// under search reads "Filter your River", and "Clear the filter" once a filter is on. The API
// replays recorded responses; nothing leaves loopback (fixtures.ts).

async function openFeed(page: Page, path = "/"): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(path);
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
}

test.describe("Clear the filter in the filter column", () => {
  test("Filter your River with no filter on; Clear the filter below search with filters on; one click clears them all", async ({ page }) => {
    await openFeed(page);
    const sidebar = page.getByRole("complementary", { name: "Filters" });
    const action = sidebar.getByTestId("sidebar-filter-action");
    const clear = sidebar.getByRole("button", { name: "Clear the filter" });
    await expect(action).toHaveText("Filter your River");
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
    // Search, then the button: no title above them (ui-revisions-10 item 1).
    expect(await sidebar.evaluate((el) => el.children[1]?.getAttribute("data-testid"))).toBe("sidebar-filter-action");
    await expect(sidebar.getByRole("heading", { level: 2 })).toHaveCount(0);

    await clear.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(search).toHaveValue("");
    // The same button, back to "Filter your River", keeps focus.
    await expect(action).toHaveText("Filter your River");
    await expect(action).toBeFocused();
    await expect(sidebar.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(sidebar.locator("[aria-pressed=true]")).toHaveCount(1);
    await expect(page.getByTestId("active-filters")).toHaveCount(0);
    await expect(clear).toHaveCount(0);
  });

  test("with nothing on, Filter your River opens the sections and goes to the first filter", async ({ page }) => {
    await openFeed(page);
    const sidebar = page.getByRole("complementary", { name: "Filters" });
    const toggle = sidebar.getByRole("button", { name: "Circles", exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await sidebar.getByRole("button", { name: "Filter your River" }).click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar.getByRole("button", { name: "All", exact: true })).toBeFocused();
  });

  test("the mode stays; a single search alone shows it, and it works from the keyboard", async ({ page }) => {
    await openFeed(page, "/?mode=civic&q=meeting");
    const sidebar = page.getByRole("complementary", { name: "Filters" });
    const clear = sidebar.getByRole("button", { name: "Clear the filter" });
    await expect(clear).toBeVisible();
    await clear.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/\?mode=civic$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "civic");
    await expect(clear).toHaveCount(0);
  });
});
