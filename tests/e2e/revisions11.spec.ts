import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 11 item 2 (docs/spec/ui-revisions-11.md): one source at a time, from a dropdown in
// the filters or a card's source name. Item 1 (no Following link in the bar) is in
// profile.spec.ts and modes.spec.ts. The API replays recorded responses; nothing leaves loopback.

async function openFeed(page: Page, width = 1440, path = "/"): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
}

/** The source names on the cards now showing. */
async function shownSources(page: Page): Promise<string[]> {
  return [...new Set(await page.getByTestId("feed-card").locator(".card-source").allTextContents())];
}

test.describe("item 2: one source at a time", () => {
  test("the Source dropdown lists the sources and shows only the one chosen; it stays in the URL and clears", async ({ page }) => {
    await openFeed(page);
    const sidebar = page.getByRole("complementary", { name: "Filters" });
    const select = sidebar.getByRole("combobox", { name: "Show posts from" });
    await expect(select).toHaveValue("");
    await expect(select.locator("option").first()).toHaveText("All sources");
    // Grouped by network.
    await expect(select.locator("optgroup")).not.toHaveCount(0);
    await expect(select.locator("option", { hasText: "The Millbrook Ledger" })).toHaveCount(1);

    await select.selectOption({ label: "The Millbrook Ledger" });
    await expect(page).toHaveURL(/[?&]source=[0-9a-f-]{36}/);
    await expect.poll(() => shownSources(page)).toEqual(["The Millbrook Ledger"]);
    // It counts as a filter: the wide button offers to clear it.
    const action = sidebar.getByTestId("sidebar-filter-action");
    await expect(action).toHaveText("Clear the filter");

    // A reload keeps it.
    await page.reload();
    await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
    await expect(select).not.toHaveValue("");
    await expect.poll(() => shownSources(page)).toEqual(["The Millbrook Ledger"]);

    // Clear the filter clears it.
    await action.click();
    await expect(select).toHaveValue("");
    await expect(page).not.toHaveURL(/source=/);
    await expect.poll(async () => (await shownSources(page)).length).toBeGreaterThan(1);
  });

  test("a card's source name shows only that source", async ({ page }) => {
    await openFeed(page);
    const card = page.getByTestId("feed-card").filter({ has: page.getByTestId("card-source") }).first();
    const name = (await card.getByTestId("card-source").textContent())!;
    await card.getByRole("button", { name: `Show only posts from ${name}` }).click();
    await expect(page).toHaveURL(/[?&]source=/);
    await expect.poll(() => shownSources(page)).toEqual([name]);
    await expect(page.getByRole("complementary", { name: "Filters" }).getByRole("combobox", { name: "Show posts from" })).not.toHaveValue("");
    // Clicking the name doesn't open the item.
    await expect(page.getByTestId("reader")).toHaveCount(0);
  });

  test("on a phone the filter sheet has the same dropdown, and the button sums it up", async ({ page }) => {
    await openFeed(page, 390);
    await page.getByRole("button", { name: /^Filter your River/ }).click();
    const sheet = page.getByRole("dialog", { name: "Filter your River" });
    const select = sheet.getByRole("combobox", { name: "Show posts from" });
    await select.selectOption({ label: "The Millbrook Ledger" });
    await expect(page).toHaveURL(/[?&]source=/);
    await sheet.getByRole("button", { name: "Show results" }).click();
    await expect(page.getByRole("button", { name: /^Filter your River · 1/ })).toContainText("The Millbrook Ledger");
    await expect.poll(() => shownSources(page)).toEqual(["The Millbrook Ledger"]);
  });
});
