import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 2 (docs/spec/ui-revisions-2.md), the parts UI revisions 3 kept. Item 2's embedded
// view now opens only pages the framing check allows, and a click never opens the reader
// (ui-revisions-3 items 1 and 2): those checks live in revisions3.spec.ts. The reader still shows
// at a sample's own address, so items 1 and 3 are checked there. The API replays recorded
// responses; nothing leaves loopback (fixtures.ts), and a framed document gets a stand-in page.

const DESKTOP = { width: 1440, height: 1000 };
const PHONE = { width: 390, height: 844 };

interface ApiItem {
  id: string;
  url: string | null;
  source: string;
}

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

function sidebar(page: Page): Locator {
  return page.getByRole("complementary", { name: "Filters" });
}

async function openFeed(page: Page, path = "/", viewport = DESKTOP): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
}

async function firstSample(page: Page): Promise<ApiItem> {
  const body = (await (await page.request.get("/api/feed")).json()) as { items: ApiItem[] };
  return body.items.find((i) => i.source === "sample")!;
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not rendered");
  return b;
}

test.describe("item 1: the filter column stays put", () => {
  test("a sample's address shows the reader with the filter column where the feed has it; Back to River too", async ({ page }) => {
    await openFeed(page);
    await expect(page.getByTestId("plugin-coming-up")).toBeVisible();
    const before = await box(sidebar(page));
    const sample = await firstSample(page);

    await page.goto(`/item/${sample.id}`);
    await expect(page.getByTestId("reader")).toHaveAttribute("data-item-id", sample.id, { timeout: 30_000 });
    expect(await box(sidebar(page))).toEqual(before);
    await page.getByRole("button", { name: "Back to River" }).click();
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    expect(await box(sidebar(page))).toEqual(before);
  });
});

test.describe("item 3: the reader is wide", () => {
  test("the reader spans the feed's and Coming up's columns; Coming up isn't beside it", async ({ page }) => {
    await openFeed(page);
    const feed = await box(page.locator("main.feed"));
    const comingUp = await box(page.locator(".plugin-column"));
    const sample = await firstSample(page);
    await page.goto(`/item/${sample.id}`);
    await expect(page.getByTestId("reader")).toHaveAttribute("data-item-id", sample.id, { timeout: 30_000 });
    const reader = await box(page.getByTestId("reader"));
    // Edge to edge (ui-revisions-8 item 3), the reader is the old feed and Coming up columns
    // together, centred beside the filters: wider than the feed, reaching where Coming up was.
    expect(reader.width).toBeGreaterThan(feed.width + comingUp.width / 2);
    expect(reader.x).toBeLessThanOrEqual(feed.x);
    expect(reader.x + reader.width).toBeLessThanOrEqual(comingUp.x + comingUp.width + 1);
    await expect(page.getByTestId("plugin-coming-up")).toHaveCount(0);
  });

  test("on a phone the reader fits 390 px", async ({ page }) => {
    await openFeed(page, "/", PHONE);
    const sample = await firstSample(page);
    await page.goto(`/item/${sample.id}`);
    await expect(page.getByTestId("reader")).toBeVisible({ timeout: 30_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("item 2: the CSP lets the embedded view frame https sources", () => {
  test("frame-src https:, and framing raises no CSP violation", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });
    await page.route("https://**/*", async (route) => {
      const request = route.request();
      if (request.resourceType() !== "document" || request.frame() === page.mainFrame()) return route.fallback();
      await route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><p data-testid="stand-in">Stand-in</p>' });
    });
    // No recorded non-fediverse page allows framing, so the check's answer is a stand-in here.
    await page.route("**/api/items/*/frame", (route) => route.fulfill({ json: { frame: { url: "https://longmont.civic.social/stand-in" } } }));
    await page.setViewportSize(DESKTOP);
    const res = await page.goto("/?network=hubs");
    expect(res!.headers()["content-security-policy"]).toMatch(/(^|; )frame-src https:(;|$)/);
    const card = cards(page).first();
    await expect(card).toHaveAttribute("data-open", "frame", { timeout: 30_000 });
    await card.locator(".card-kind").click();
    await expect(page.frameLocator("[data-testid=external-frame]").getByTestId("stand-in")).toBeVisible();
    expect(violations).toEqual([]);
  });
});
