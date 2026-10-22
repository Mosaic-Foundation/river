import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 3 (docs/spec/ui-revisions-3.md), one describe block per item. The API replays
// recorded responses; nothing leaves loopback (fixtures.ts), and a framed document gets a
// stand-in page here so the embedded view really loads.

const DESKTOP = { width: 1440, height: 1000 };
const PHONE = { width: 390, height: 844 };

interface ApiItem {
  id: string;
  url: string | null;
  space: { adapter: string };
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not rendered");
  return b;
}

/** Framed documents get a stand-in page. */
async function standInFrames(page: Page): Promise<void> {
  await page.route("https://**/*", async (route) => {
    const request = route.request();
    if (request.resourceType() !== "document" || request.frame() === page.mainFrame()) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Stand-in</title><p>Stand-in</p>" });
  });
}

/** Opens the embedded view on a fediverse post straight from its address. */
async function openEmbedded(page: Page): Promise<void> {
  await standInFrames(page);
  await page.goto("/");
  const body = (await (await page.request.get("/api/feed?network=fediverse")).json()) as { items: ApiItem[] };
  const post = body.items.find((i) => /^https:\/\/[^/]+\/@[^/]+\/\d+$/.test(i.url ?? ""))!;
  await page.goto(`/item/${post.id}`);
  await expect(page.getByTestId("external-view")).toBeVisible({ timeout: 30_000 });
}

test.describe("item 3: a narrower River bar", () => {
  for (const [name, viewport, maxWidth] of [
    ["desktop", DESKTOP, 56],
    ["phone", PHONE, 44],
  ] as const) {
    test(`${name}: the bar is narrow; the mark is centered vertically and fills most of its tile`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openEmbedded(page);
      const bar = await box(page.locator(".external-bar"));
      expect(bar.width).toBeLessThanOrEqual(maxWidth);
      expect(bar.height).toBe(viewport.height);

      const tile = await box(page.locator(".external-mark"));
      const mark = await box(page.locator(".external-mark img"));
      expect(Math.abs(tile.y + tile.height / 2 - (bar.y + bar.height / 2))).toBeLessThanOrEqual(2);
      expect(Math.abs(tile.x + tile.width / 2 - (bar.x + bar.width / 2))).toBeLessThanOrEqual(1);
      expect(mark.width / tile.width).toBeGreaterThanOrEqual(0.75);
      expect(mark.height / tile.height).toBeGreaterThanOrEqual(0.75);
      // The mark stays inside its tile, and "River" and the new-tab link still fit the bar.
      expect(mark.x).toBeGreaterThanOrEqual(tile.x);
      expect(mark.x + mark.width).toBeLessThanOrEqual(tile.x + tile.width + 0.5);
      const label = await box(page.locator(".external-label"));
      expect(label.x).toBeGreaterThanOrEqual(bar.x);
      expect(label.x + label.width).toBeLessThanOrEqual(bar.x + bar.width);
      await expect(page.getByRole("link", { name: /^Open in new tab/ })).toBeInViewport();

      await page.getByRole("button", { name: "Back to the River" }).click();
      await expect(page.getByTestId("feed-card").first()).toBeVisible();
    });
  }
});
