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
  source: string;
  space: { adapter: string };
}

const HUB_PAGE = "https://longmont.civic.social/meeting-summary/proc_4ebb11759c4c40ce";
const SANDBOX = ["allow-scripts", "allow-same-origin", "allow-forms", "allow-popups", "allow-popups-to-escape-sandbox"];

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

function card(page: Page, id: string): Locator {
  return page.locator(`[data-testid="feed-card"][data-item-id="${id}"]`);
}

async function openFeed(page: Page, path = "/", viewport: { width: number; height: number } = DESKTOP): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
}

/** The visitor's first page of items for `query`. */
async function firstPage(page: Page, query = ""): Promise<ApiItem[]> {
  return ((await (await page.request.get(`/api/feed${query}`)).json()) as { items: ApiItem[] }).items;
}

/** Every framing check the page asks the API for, by item id. */
function frameChecks(page: Page): string[] {
  const checks: string[] = [];
  page.on("request", (req) => {
    const m = /\/api\/items\/([0-9a-f-]{36})\/frame$/.exec(new URL(req.url()).pathname);
    if (m) checks.push(m[1]!);
  });
  return checks;
}

/**
 * Answers every framing check as if the page allowed framing. No recorded non-fediverse page does
 * (the API test proves the server's answer on a recorded page that allows it), so the UI's
 * framed path is driven by this stand-in answer.
 */
async function allowFraming(page: Page, url = "https://longmont.civic.social/stand-in"): Promise<void> {
  await page.route("**/api/items/*/frame", (route) => route.fulfill({ json: { frame: { url } } }));
}

/** Holds every framing check until the returned function is called. */
async function holdFraming(page: Page): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/items/*/frame", async (route) => {
    await held;
    await route.fallback();
  });
  return release;
}

/** Collects the new tabs the page opens, by URL. */
function newTabs(page: Page): string[] {
  const urls: string[] = [];
  page.context().on("page", (tab) => {
    urls.push(tab.url());
    void tab.waitForURL(/./).then(() => urls.push(tab.url())).catch(() => {});
  });
  return urls;
}

async function settledScroll(page: Page): Promise<number> {
  let y = -1;
  await expect
    .poll(async () => {
      const now = await page.evaluate(() => window.scrollY);
      const settled = now === y;
      y = now;
      return settled;
    })
    .toBe(true);
  return y;
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

/** Opens the embedded view on a fediverse post straight from its address (its "Open on" screen). */
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

test.describe("item 1: fediverse posts stay in the feed", () => {
  test("clicking a fediverse card's body does nothing; its title and time aren't links", async ({ page }) => {
    const tabs = newTabs(page);
    const checks = frameChecks(page);
    await openFeed(page);
    const post = (await firstPage(page)).find((i) => i.space.adapter === "fediverse")!;
    const target = card(page, post.id);
    await expect(target).toHaveAttribute("data-open", "none");
    await target.locator(".card-text").first().click({ position: { x: 2, y: 2 } });
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("external-view")).toHaveCount(0);
    await expect(page.getByTestId("reader")).toHaveCount(0);
    await expect(target).toBeVisible();
    expect(tabs).toEqual([]);
    await expect(target.locator(".card-title-link, .card-permalink")).toHaveCount(0);
    // Fediverse posts are never checked for framing.
    const fediverse = new Set((await firstPage(page)).filter((i) => i.space.adapter === "fediverse").map((i) => i.id));
    expect(checks.filter((id) => fediverse.has(id))).toEqual([]);
  });

  test("every live card has Open ↗, the original in a new tab; samples have none; using it marks the item read", async ({ page }) => {
    await openFeed(page);
    const items = await firstPage(page);
    for (const item of items.filter((i) => i.source === "live")) {
      const open = card(page, item.id).getByTestId("card-open");
      if ((await card(page, item.id).count()) === 0) continue; // folded into a hub group
      await expect(open).toHaveText(/^Open ↗/);
      await expect(open).toHaveAttribute("href", item.url!);
      await expect(open).toHaveAttribute("target", "_blank");
      expect((await open.getAttribute("rel"))!.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
      await expect(open).toHaveAccessibleName(`Open on ${new URL(item.url!).host} (opens in a new tab)`);
    }
    for (const item of items.filter((i) => i.source === "sample")) {
      await expect(card(page, item.id).getByTestId("card-open")).toHaveCount(0);
      await expect(card(page, item.id)).toHaveAttribute("data-open", "none");
    }

    const post = items.find((i) => i.space.adapter === "fediverse")!;
    await expect(card(page, post.id).getByTestId("unread-dot")).toBeVisible();
    const popup = page.context().waitForEvent("page");
    await card(page, post.id).getByTestId("card-open").click();
    await (await popup).close();
    await expect(card(page, post.id).getByTestId("unread-dot")).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("item 2: other items are framed, or open in a new tab", () => {
  test("visible cards are checked ahead of time; a refused page opens in a new tab on click and the River stays", async ({ page }) => {
    const checks = frameChecks(page);
    await openFeed(page);
    const hub = (await firstPage(page)).find((i) => i.url === HUB_PAGE)!;
    const target = card(page, hub.id);
    // Below the fold it isn't asked yet; in view, it is, before any click (the recorded page
    // sends X-Frame-Options DENY).
    expect(checks).not.toContain(hub.id);
    await target.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(target).toHaveAttribute("data-open", "tab");
    expect(checks).toContain(hub.id);
    await expect(target.locator(".card-title-link")).toHaveAttribute("href", HUB_PAGE);
    await expect(target.locator(".card-title-link")).toHaveAttribute("target", "_blank");

    // The new tab asks for the original (fixtures.ts then cuts it off, as every outside host).
    const popup = page.context().waitForEvent("page");
    const navigation = page.context().waitForEvent("request", (r) => r.isNavigationRequest() && r.url() === HUB_PAGE);
    await target.locator(".card-chips, .card-text").first().click({ position: { x: 2, y: 2 } });
    const tab = await popup;
    expect((await navigation).frame().page()).toBe(tab);
    await tab.close();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("external-view")).toHaveCount(0);
    await expect(page.getByTestId("reader")).toHaveCount(0);
    await expect(target.getByTestId("unread-dot")).toHaveCount(0);
  });

  test("a page the check allows opens framed at /item/{id}; the bar and Back return to the same place and filters; Forward reopens", async ({ page }) => {
    await standInFrames(page);
    await allowFraming(page);
    await openFeed(page, "/?network=hubs");
    const target = cards(page).nth(6);
    await target.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(target).toHaveAttribute("data-open", "frame");
    const y = await settledScroll(page);
    expect(y).toBeGreaterThan(200);
    const id = (await target.getAttribute("data-item-id"))!;

    await target.locator(".card-source").click();
    await expect(page).toHaveURL(new RegExp(`/item/${id}\\?network=hubs$`));
    const frame = page.getByTestId("external-frame");
    await expect(frame).toHaveAttribute("src", "https://longmont.civic.social/stand-in");
    expect((await frame.getAttribute("sandbox"))!.split(/\s+/).sort()).toEqual([...SANDBOX].sort());
    await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(page.getByRole("button", { name: "Back to the River" })).toBeFocused();
    await expect(cards(page).first()).toBeHidden();

    await page.getByRole("button", { name: "Back to the River" }).click();
    await expect(page).toHaveURL(/\/\?network=hubs$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);
    await card(page, id).locator(".card-source").click();
    await expect(frame).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("external-view")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);
    await page.goForward();
    await expect(page.getByTestId("external-frame")).toBeVisible();
  });

  test("a card clicked before its check answers shows Open on {host} ↗ beside the bar; an allowing answer then frames it", async ({ page }) => {
    await standInFrames(page);
    const release = await holdFraming(page);
    await openFeed(page);
    const hub = (await firstPage(page)).find((i) => i.url === HUB_PAGE)!;
    await expect(card(page, hub.id)).toHaveAttribute("data-open", "pending");
    await card(page, hub.id).locator(".card-source").click();

    await expect(page).toHaveURL(new RegExp(`/item/${hub.id}$`));
    const screen = page.getByTestId("external-elsewhere");
    await expect(screen).toContainText("Checking whether longmont.civic.social can be shown here…");
    const open = screen.getByRole("link", { name: "Open on longmont.civic.social (opens in a new tab)" });
    await expect(open).toContainText("Open on longmont.civic.social ↗");
    await expect(open).toHaveAttribute("href", HUB_PAGE);
    await expect(open).toHaveAttribute("target", "_blank");
    expect((await open.getAttribute("rel"))!.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    await expect(page.getByRole("button", { name: "Back to the River" })).toBeVisible();

    // The real answer refuses: the screen stays, and its button opens the original.
    release();
    await expect(screen).toContainText("longmont.civic.social opens in its own tab.");
    const popup = page.context().waitForEvent("page");
    await open.click();
    await (await popup).close();
    await expect(page.getByTestId("external-frame")).toHaveCount(0);
  });

  test("an allowing answer that arrives after the click replaces the Open on screen with the frame", async ({ page }) => {
    await standInFrames(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/items/*/frame", async (route) => {
      await held;
      await route.fulfill({ json: { frame: { url: "https://longmont.civic.social/stand-in" } } });
    });
    await openFeed(page);
    const hub = (await firstPage(page)).find((i) => i.url === HUB_PAGE)!;
    await card(page, hub.id).locator(".card-source").click();
    await expect(page.getByTestId("external-elsewhere")).toBeVisible();
    release();
    await expect(page.getByTestId("external-frame")).toHaveAttribute("src", "https://longmont.civic.social/stand-in");
    await expect(page.getByTestId("external-elsewhere")).toHaveCount(0);
  });

  test("an address of a fediverse post or a refused page shows Open on {host} ↗; a sample's shows the reader", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    const items = await firstPage(page);
    const post = items.find((i) => i.space.adapter === "fediverse")!;
    await page.goto(`/item/${post.id}`);
    const screen = page.getByTestId("external-elsewhere");
    await expect(screen).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole("link", { name: /^Open on / })).toHaveAttribute("href", post.url!);
    await expect(page.getByTestId("external-frame")).toHaveCount(0);

    const hub = items.find((i) => i.url === HUB_PAGE)!;
    await page.goto(`/item/${hub.id}`);
    await expect(screen).toContainText("longmont.civic.social opens in its own tab.", { timeout: 30_000 });

    const sample = items.find((i) => i.source === "sample")!;
    await page.goto(`/item/${sample.id}`);
    await expect(page.getByTestId("reader")).toHaveAttribute("data-item-id", sample.id, { timeout: 30_000 });
    await expect(page.getByTestId("external-view")).toHaveCount(0);
  });

  test("from the keyboard: a refused card's title link opens the original; an allowed one's opens the frame", async ({ page }) => {
    await openFeed(page, "/?network=hubs");
    const refused = cards(page).filter({ has: page.locator(".card-title-link") }).first();
    await expect(refused).toHaveAttribute("data-open", "tab");
    const popup = page.context().waitForEvent("page");
    await refused.locator(".card-title-link").press("Enter");
    await (await popup).close();
    await expect(page).toHaveURL(/\/\?network=hubs$/);

    await standInFrames(page);
    await allowFraming(page);
    await page.reload();
    const allowed = cards(page).filter({ has: page.locator(".card-title-link") }).first();
    await expect(allowed).toHaveAttribute("data-open", "frame", { timeout: 30_000 });
    await allowed.locator(".card-title-link").press("Enter");
    await expect(page.getByTestId("external-frame")).toBeVisible();
  });
});
