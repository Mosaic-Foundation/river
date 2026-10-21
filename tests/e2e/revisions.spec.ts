import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 1 (docs/spec/ui-revisions-1.md), one describe block per item. The API replays
// recorded responses; nothing leaves loopback (fixtures.ts).

const DESKTOP = { width: 1440, height: 1000 };

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

function sidebar(page: Page): Locator {
  return page.getByRole("complementary", { name: "Filters" });
}

async function openFeed(page: Page, path = "/"): Promise<void> {
  await page.setViewportSize(DESKTOP);
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
}

test.describe("item 5: Civic mode lists only the civic circle", () => {
  test("Everything lists every circle; Civic lists All and Civic only, and falls back to All", async ({ page }) => {
    await openFeed(page);
    const circles = sidebar(page).getByRole("navigation", { name: "Circles" }).getByRole("button");
    const everything = await circles.allTextContents();
    expect(everything.length).toBeGreaterThan(2);
    expect(everything).toContain("Civic");

    // Pick a circle that isn't civic, then switch to Civic: the filter falls back to All.
    const other = everything.find((name) => name !== "All" && name !== "Civic")!;
    await circles.filter({ hasText: other }).click();
    await expect(page).toHaveURL(/circle=/);
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Civic" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "civic");
    await expect(circles).toHaveText(["All", "Civic"]);
    await expect(circles.filter({ hasText: "All" })).toHaveAttribute("aria-pressed", "true");
    await expect(page).not.toHaveURL(/circle=/);
    await expect(page.getByTestId("plugin-coming-up")).toBeVisible();

    // The phone chip row lists the same circles.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("group", { name: "Filters" }).getByRole("list", { name: "Circles" }).getByRole("button")).toHaveText([
      "All",
      "Civic",
    ]);

    // Back in Everything, every circle shows again.
    await page.setViewportSize(DESKTOP);
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Everything" }).click();
    await expect(circles).toHaveText(everything);
  });
});

test.describe("item 8: the Sample River line", () => {
  test("a visitor sees the line with a Sign in link, on desktop and phone", async ({ page }) => {
    await openFeed(page);
    const line = page.getByTestId("sample-banner");
    await expect(line).toHaveText("Sample River · Sign in to make it your own");
    await expect(line.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/api/auth/signin");
    // At the top of the page, above the header.
    const lineBox = (await line.boundingBox())!;
    const headerBox = (await page.locator(".topbar").boundingBox())!;
    expect(lineBox.y).toBeLessThan(headerBox.y);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(line).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
