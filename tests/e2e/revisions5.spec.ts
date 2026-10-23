import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 5 (docs/spec/ui-revisions-5.md), one describe block per item. The API replays
// recorded responses; nothing leaves loopback (fixtures.ts).

const DESKTOP = { width: 1440, height: 1000 };
const PHONE = { width: 390, height: 844 };
const VIEWS = [
  { mode: "everything", path: "/", h1: "Everything" },
  { mode: "civic", path: "/?mode=civic", h1: "Citizen Dashboard" },
];

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

async function openFeed(page: Page, path: string, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
}

/** The visible boxes in the feed column that sit above its first card. */
async function visibleAboveFirstCard(page: Page): Promise<string[]> {
  return page.locator("main.feed").evaluate((feed) => {
    const first = feed.querySelector('[data-testid="feed-card"]')!.getBoundingClientRect();
    const above: string[] = [];
    for (const el of feed.querySelectorAll<HTMLElement>("*")) {
      if (el.closest('[data-testid="feed-card"]') || el.closest("[hidden]")) continue;
      if (el.children.length > 0 || !el.textContent?.trim()) continue;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // Visually hidden text (the h1) is clipped to 1px; it isn't shown.
      if (box.width <= 1 || box.height <= 1 || style.visibility === "hidden") continue;
      if (box.bottom <= first.top + 1) above.push(el.textContent.trim());
    }
    return above;
  });
}

test.describe("item 1: the feed starts with an item", () => {
  for (const view of VIEWS) {
    for (const [width, viewport] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
      test(`${view.mode} at ${width} width: no title, summary or Mark all read above the first card`, async ({ page }) => {
        await openFeed(page, view.path, viewport);
        expect(await visibleAboveFirstCard(page)).toEqual([]);
        await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);
        await expect(page.getByText(/unread · newest first/i)).toHaveCount(0);
        // One h1 names the view for assistive tech.
        const h1 = page.getByRole("heading", { level: 1 });
        await expect(h1).toHaveCount(1);
        await expect(h1).toHaveText(view.h1);
        // The first card's top is near the column's top.
        const feedTop = (await page.locator("main.feed").boundingBox())!.y;
        const cardTop = (await cards(page).first().boundingBox())!.y;
        expect(cardTop - feedTop).toBeLessThan(40);
      });
    }
  }

  test("a card's Mark read still works", async ({ page }) => {
    await openFeed(page, "/", DESKTOP);
    const first = cards(page).first();
    await expect(first.getByTestId("unread-dot")).toBeVisible();
    await first.getByRole("button", { name: "Mark read" }).click();
    await expect(first.getByTestId("unread-dot")).toHaveCount(0);
    await first.getByRole("button", { name: "Mark unread" }).click();
    await expect(first.getByTestId("unread-dot")).toBeVisible();
  });
});

test.describe("item 2: Citizen Dashboard in Civic mode", () => {
  test("Civic shows it centred in the top bar; the h1 and window title say it too", async ({ page }) => {
    await openFeed(page, "/?mode=civic", DESKTOP);
    const title = page.locator("header.topbar").getByTestId("topbar-title");
    await expect(title).toHaveText("Citizen Dashboard");
    await expect(title).toBeVisible();
    const bar = (await page.locator("header.topbar").boundingBox())!;
    const box = (await title.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - (bar.x + bar.width / 2))).toBeLessThanOrEqual(4);
    expect(Math.abs(box.y + box.height / 2 - (bar.y + bar.height / 2))).toBeLessThanOrEqual(4);
    // It overlaps neither the mode switch nor the actions.
    const start = (await page.locator(".topbar-start").boundingBox())!;
    const actions = (await page.locator(".topbar-actions").boundingBox())!;
    expect(box.x).toBeGreaterThan(start.x + start.width);
    expect(box.x + box.width).toBeLessThan(actions.x);
    await expect(page).toHaveTitle("Citizen Dashboard · Mosaic River");
    await expect(page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Civic" })).toHaveAttribute("aria-pressed", "true");

    // Switching to Everything takes the title away.
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Everything" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "mosaic");
    await expect(page.getByTestId("topbar-title")).toHaveCount(0);
    await expect(page).toHaveTitle("Everything · Mosaic River");
  });

  test("at phone width it has its own line in the bar, with no sideways scroll", async ({ page }) => {
    await openFeed(page, "/?mode=civic", PHONE);
    const title = page.getByTestId("topbar-title");
    await expect(title).toBeVisible();
    await expect(title).toBeInViewport();
    const box = (await title.boundingBox())!;
    const start = (await page.locator(".topbar-start").boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(start.y + start.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
