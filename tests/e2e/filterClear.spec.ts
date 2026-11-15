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
    // Search, then the button, first in the column: no title above them (ui-revisions-10 item 1).
    const top = sidebar.getByTestId("sidebar-top");
    expect(await sidebar.evaluate((el) => el.children[0]?.getAttribute("data-testid"))).toBe("sidebar-top");
    expect(await top.evaluate((el) => el.children[1]?.getAttribute("data-testid"))).toBe("sidebar-filter-action");
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

test.describe("Clear stays in reach while the filters scroll", () => {
  test("desktop: scrolled to its last control, the column still shows Clear the filter under search, and it clears", async ({ page }) => {
    // Short enough that the column scrolls on its own (filterColumn.spec.ts).
    await page.setViewportSize({ width: 1440, height: 480 });
    await page.goto("/?type=civic");
    await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
    const column = page.locator(".filter-column");
    const sidebar = page.getByRole("complementary", { name: "Filters" });
    const clear = sidebar.getByRole("button", { name: "Clear the filter" });
    await expect(clear).toBeVisible();

    await column.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(sidebar.getByRole("combobox", { name: "Show posts from" })).toBeInViewport();
    await expect(clear).toBeInViewport();
    await expect(sidebar.getByRole("searchbox", { name: "Search your River" })).toBeInViewport();
    // Pinned to the column's top edge, above the pills scrolling beneath it.
    const columnBox = (await column.boundingBox())!;
    const clearBox = (await clear.boundingBox())!;
    expect(clearBox.y).toBeGreaterThanOrEqual(columnBox.y);
    expect(clearBox.y + clearBox.height).toBeLessThan(columnBox.y + columnBox.height / 2);
    await clear.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(sidebar.getByTestId("sidebar-filter-action")).toHaveText("Filter your River");
  });

  test("phone: scrolled to the end of the sheet, Clear all is still at the top and clears", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto("/?type=civic");
    await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("filter-button").click();
    const sheet = page.getByTestId("filter-sheet");
    await expect(sheet).toBeVisible();
    const body = sheet.locator(".filter-sheet-body");
    const clear = sheet.getByTestId("sheet-clear");
    await expect(clear).toBeVisible();

    const sizes = await body.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    await body.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(sheet.getByRole("combobox", { name: "Show posts from" })).toBeInViewport();
    await expect(clear).toBeInViewport();
    const bodyBox = (await body.boundingBox())!;
    const clearBox = (await clear.boundingBox())!;
    expect(clearBox.y).toBeGreaterThanOrEqual(bodyBox.y);
    expect(clearBox.y + clearBox.height).toBeLessThan(bodyBox.y + bodyBox.height / 2);
    await clear.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(clear).toHaveCount(0);
    await expect(sheet).toBeVisible();
  });
});
