import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 3 (docs/spec/ui-revisions-3.md), items 4 and 5: the filter column. The API
// replays recorded responses; nothing leaves loopback (fixtures.ts).

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not rendered");
  return b;
}

test.describe("item 4: the filter column scrolls on its own", () => {
  test("taller than the window, it scrolls by itself to its last control and stays put while the feed scrolls", async ({ page }) => {
    // Short enough that the column (search, circles, types, networks) doesn't fit.
    await page.setViewportSize({ width: 1440, height: 480 });
    await page.goto("/");
    await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
    const column = page.locator(".filter-column");
    const sidebar = page.getByRole("complementary", { name: "Filters" });

    const sizes = await column.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    // Once the page has scrolled past the sample line, the column sticks below the header and
    // fits the window; from then on it keeps its place while the feed scrolls.
    await page.mouse.move(800, 300);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    const before = await box(column);
    expect(before.y + before.height).toBeLessThanOrEqual(480);
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1500);
    const scrolled = await box(column);
    expect(scrolled.y).toBe(before.y);
    expect(scrolled.height).toBe(before.height);

    // The column scrolls by itself (the window doesn't), down to its last control.
    const windowY = await page.evaluate(() => window.scrollY);
    const last = sidebar.getByRole("button").last();
    await expect(last).not.toBeInViewport();
    const at = await box(column);
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.wheel(0, 2000);
    await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBe(sizes.scroll - sizes.client);
    await expect(last).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(windowY);
    await last.click();
    await expect(last).toHaveAttribute("aria-pressed", "true");
  });

  test("a window tall enough shows the whole column without a scrollbar", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1400 });
    await page.goto("/");
    await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
    const sizes = await page.locator(".filter-column").evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(sizes.scroll).toBe(sizes.client);
  });
});
