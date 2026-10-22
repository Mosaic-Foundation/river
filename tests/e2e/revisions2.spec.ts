import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 2 (docs/spec/ui-revisions-2.md), one describe block per item. The API replays
// recorded responses, including the framing check's two pages (a socialwebfoundation.org article
// that allows framing, a Longmont Civic Hub page that sends DENY). The browser reaches nothing
// off loopback (fixtures.ts); here a framed page's document is answered by a stand-in page, so
// the iframe really loads under the River's CSP without touching the real host.

const DESKTOP = { width: 1440, height: 1000 };
const PHONE = { width: 390, height: 844 };
const ARTICLE = "https://socialwebfoundation.org/2026/10/13/fosdem-2027-dev-room-application-is-in/";
const HUB_PAGE = "https://longmont.civic.social/meeting-summary/proc_4ebb11759c4c40ce";
const SANDBOX = ["allow-scripts", "allow-same-origin", "allow-forms", "allow-popups", "allow-popups-to-escape-sandbox"];

interface ApiItem {
  id: string;
  url: string | null;
  source: string;
  title: string | null;
  space: { adapter: string; name: string };
}

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

function sidebar(page: Page): Locator {
  return page.getByRole("complementary", { name: "Filters" });
}

/** Framed documents get a stand-in page that names the URL it was asked for. */
async function standInFrames(page: Page, framed: string[] = []): Promise<string[]> {
  await page.route("https://**/*", async (route) => {
    const request = route.request();
    if (request.resourceType() !== "document" || request.frame() === page.mainFrame()) {
      await route.fallback();
      return;
    }
    framed.push(request.url());
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>Stand-in</title><p data-testid="stand-in">Stand-in for ${request.url()}</p>`,
    });
  });
  return framed;
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

async function openFeed(page: Page, path = "/", viewport = DESKTOP): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
}

/** The first stored item matching `keep`, paging through the visitor's feed. */
async function findItem(page: Page, keep: (item: ApiItem) => boolean, query = ""): Promise<ApiItem> {
  let cursor: string | null = null;
  for (let n = 0; n < 30; n++) {
    const params = new URLSearchParams(query);
    if (cursor) params.set("cursor", cursor);
    const body = (await (await page.request.get(`/api/feed?${params}`)).json()) as { items: ApiItem[]; nextCursor: string | null };
    const found = body.items.find(keep);
    if (found) return found;
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  throw new Error("No stored item matches");
}

const isMastodonPost = (i: ApiItem) => i.space.adapter === "fediverse" && /^https:\/\/[^/]+\/@[^/]+\/\d+$/.test(i.url ?? "");

/** Waits until the window's scroll position stops moving (late images), and returns it. */
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

test.describe("item 2: the embedded view", () => {
  test("a Mastodon post opens in its /embed page, sandboxed, beside the River bar; the feed is gone", async ({ page }) => {
    const framed = await standInFrames(page);
    const checks = frameChecks(page);
    await openFeed(page);
    const post = await findItem(page, isMastodonPost);
    const card = page.locator(`[data-testid="feed-card"][data-item-id="${post.id}"]`);
    await card.locator(".card-source").click();

    await expect(page).toHaveURL(new RegExp(`/item/${post.id}$`));
    const view = page.getByTestId("external-view");
    await expect(view).toBeVisible();
    const frame = view.getByTestId("external-frame");
    await expect(frame).toHaveAttribute("src", `${post.url}/embed`);
    expect((await frame.getAttribute("sandbox"))!.split(/\s+/).sort()).toEqual([...SANDBOX].sort());
    await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(frame).toHaveAttribute("title", new RegExp(` on ${new URL(post.url!).host.replace(/\./g, "\\.")}$`));
    await expect(page.frameLocator("[data-testid=external-frame]").getByTestId("stand-in")).toHaveText(`Stand-in for ${post.url}/embed`);
    expect(framed).toEqual([`${post.url}/embed`]);
    // A Mastodon embed needs no check.
    expect(checks).toEqual([]);

    // The bar: the Mosaic mark and "River", a labelled button that has focus; Open in new tab.
    const back = view.getByRole("button", { name: "Back to the River" });
    await expect(back).toBeFocused();
    await expect(back).toHaveText("Back to the River");
    await expect(back.locator(".external-label")).toContainText("River");
    await expect(back.locator("img")).toHaveAttribute("src", "/favicon.svg");
    const open = view.getByRole("link", { name: /^Open in new tab/ });
    await expect(open).toHaveAttribute("href", post.url!);
    await expect(open).toHaveAttribute("target", "_blank");
    expect((await open.getAttribute("rel"))!.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));

    // The River is replaced: no feed, no filters, no reader; the frame fills the window.
    await expect(cards(page).first()).toBeHidden();
    await expect(sidebar(page)).toBeHidden();
    await expect(page.getByTestId("reader")).toHaveCount(0);
    const frameBox = await box(frame);
    const barBox = await box(view.locator(".external-bar"));
    expect(barBox.height).toBe(DESKTOP.height);
    expect(barBox.width).toBeLessThan(100);
    expect(Math.round(frameBox.x)).toBe(Math.round(barBox.width));
    expect(Math.round(frameBox.x + frameBox.width)).toBe(DESKTOP.width);
    expect(frameBox.height).toBe(DESKTOP.height);

    const results = await new AxeBuilder({ page }).exclude("[data-testid=external-frame]").analyze();
    expect(results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id)).toEqual([]);
  });

  test("the bar and the browser's Back return to the River at the same scroll position and filters; Forward reopens", async ({ page }) => {
    await standInFrames(page);
    await openFeed(page, "/?network=fediverse");
    const card = cards(page).nth(8);
    // Centered, so the click below doesn't have to scroll to reach it.
    await card.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    const y = await settledScroll(page);
    expect(y).toBeGreaterThan(200);
    const id = (await card.getAttribute("data-item-id"))!;

    await card.locator(".card-source").click();
    await expect(page).toHaveURL(new RegExp(`/item/${id}\\?network=fediverse$`));
    await expect(page.getByTestId("external-view")).toBeVisible();
    await page.getByRole("button", { name: "Back to the River" }).click();
    await expect(page.getByTestId("external-view")).toHaveCount(0);
    await expect(page).toHaveURL(/\/\?network=fediverse$/);
    await expect(page.getByRole("button", { name: /^Fediverse/, pressed: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);
    // Focus comes back to the card that was opened.
    await expect(page.locator(`[data-item-id="${id}"] :is(.card-title-link, .card-permalink)`)).toBeFocused();

    await page.locator(`[data-item-id="${id}"] .card-source`).click();
    await expect(page.getByTestId("external-view")).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("external-view")).toHaveCount(0);
    await expect(page).toHaveURL(/\/\?network=fediverse$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/item/${id}\\?network=fediverse$`));
    await expect(page.getByTestId("external-view")).toBeVisible();
  });

  test("loading /item/{id} directly opens the embedded view; its bar goes to the feed", async ({ page }) => {
    await standInFrames(page);
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    const post = await findItem(page, isMastodonPost);
    await page.goto(`/item/${post.id}`);
    await expect(page.getByTestId("external-frame")).toHaveAttribute("src", `${post.url}/embed`, { timeout: 30_000 });
    await page.getByRole("button", { name: "Back to the River" }).press("Enter");
    await expect(page).toHaveURL(/\/$/);
    await expect(cards(page).first()).toBeVisible();
  });

  test("a page whose headers allow framing is checked on the server, then framed", async ({ page }) => {
    const framed = await standInFrames(page);
    const checks = frameChecks(page);
    await openFeed(page);
    const search = page.getByRole("searchbox", { name: "Search your River" });
    await search.fill("FOSDEM 2027");
    await search.press("Enter");
    const card = cards(page).filter({ hasText: "FOSDEM" }).first();
    const id = (await card.getAttribute("data-item-id"))!;
    await card.locator(".card-source").click();

    await expect(page.getByTestId("external-frame")).toHaveAttribute("src", ARTICLE, { timeout: 15_000 });
    expect(checks).toEqual([id]);
    await expect(page.frameLocator("[data-testid=external-frame]").getByTestId("stand-in")).toHaveText(`Stand-in for ${ARTICLE}`);
    expect(framed).toEqual([ARTICLE]);
    await expect(page.getByRole("link", { name: /^Open in new tab/ })).toHaveAttribute("href", ARTICLE);

    // Reopening it this visit asks nothing new.
    await page.getByRole("button", { name: "Back to the River" }).click();
    await card.locator(".card-source").click();
    await expect(page.getByTestId("external-frame")).toHaveAttribute("src", ARTICLE);
    expect(checks).toEqual([id]);
  });

  test("a page that refuses framing (X-Frame-Options DENY, frame-ancestors 'none') opens in the reader, with Open in new tab", async ({ page }) => {
    const framed = await standInFrames(page);
    const checks = frameChecks(page);
    await openFeed(page);
    const hub = await findItem(page, (i) => i.url === HUB_PAGE);
    const card = page.locator(`[data-testid="feed-card"][data-item-id="${hub.id}"]`);
    await card.locator(".card-source").click();

    const reader = page.getByTestId("reader");
    await expect(reader).toHaveAttribute("data-item-id", hub.id);
    expect(checks).toEqual([hub.id]);
    await expect(page.getByTestId("external-view")).toHaveCount(0);
    expect(framed).toEqual([]);
    const open = reader.getByRole("link", { name: /^Open in new tab/ });
    await expect(open).toHaveAttribute("href", HUB_PAGE);
    await expect(open).toHaveAttribute("target", "_blank");
    expect((await open.getAttribute("rel"))!.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    await expect(sidebar(page)).toBeVisible();
  });

  test("a sample opens in the reader without a framing check", async ({ page }) => {
    const checks = frameChecks(page);
    await openFeed(page);
    await cards(page).and(page.locator('[data-source="sample"]')).first().locator(".card-source").click();
    await expect(page.getByTestId("reader")).toBeVisible();
    await expect(page.getByTestId("external-view")).toHaveCount(0);
    await expect(page.getByTestId("reader").getByRole("link", { name: /^Open in new tab/ })).toHaveCount(0);
    expect(checks).toEqual([]);
  });

  test("the CSP lets https sources frame, and framing raises no CSP violation", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });
    await standInFrames(page);
    const res = await page.goto("/");
    expect(res!.headers()["content-security-policy"]).toMatch(/(^|; )frame-src https:(;|$)/);
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    const post = await findItem(page, isMastodonPost);
    await page.locator(`[data-item-id="${post.id}"] .card-source`).click();
    await expect(page.frameLocator("[data-testid=external-frame]").getByTestId("stand-in")).toBeVisible();
    expect(violations).toEqual([]);
  });

  test("on a phone the bar is narrow and the frame takes the rest, with no horizontal scroll", async ({ page }) => {
    await standInFrames(page);
    await openFeed(page, "/", PHONE);
    const post = await findItem(page, isMastodonPost);
    await page.locator(`[data-item-id="${post.id}"] .card-source`).click();
    const bar = await box(page.locator(".external-bar"));
    const frame = await box(page.getByTestId("external-frame"));
    expect(bar.width).toBeLessThanOrEqual(56);
    expect(Math.round(frame.x + frame.width)).toBe(PHONE.width);
    await expect(page.getByRole("tablist").or(page.locator(".tabbar"))).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Back to the River" }).click();
    await expect(cards(page).first()).toBeVisible();
  });
});

test.describe("item 1: the filter column stays put", () => {
  test("opening an item in the reader, waiting on a check, and going back never move or resize it", async ({ page }) => {
    await openFeed(page);
    await expect(page.getByTestId("plugin-coming-up")).toBeVisible();
    const before = await box(sidebar(page));

    // A sample: straight to the reader.
    await cards(page).and(page.locator('[data-source="sample"]')).first().locator(".card-source").click();
    await expect(page.getByTestId("reader")).toBeVisible();
    expect(await box(sidebar(page))).toEqual(before);
    await page.getByRole("button", { name: "Back to River" }).click();
    await expect(cards(page).first()).toBeVisible();
    expect(await box(sidebar(page))).toEqual(before);

    // A hub page: "Opening…" while the server checks, then the reader.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/items/*/frame", async (route) => {
      await held;
      await route.fallback();
    });
    const hub = await findItem(page, (i) => i.url === HUB_PAGE);
    await page.locator(`[data-testid="feed-card"][data-item-id="${hub.id}"] .card-source`).click();
    await expect(page.getByTestId("reader")).toContainText("Opening longmont.civic.social…");
    expect(await box(sidebar(page))).toEqual(before);
    release();
    await expect(page.getByTestId("reader")).toHaveAttribute("data-item-id", hub.id);
    expect(await box(sidebar(page))).toEqual(before);
  });
});

test.describe("item 3: the reader is wide", () => {
  test("the reader spans the feed's and Coming up's columns; Coming up isn't beside it", async ({ page }) => {
    await openFeed(page);
    const feed = await box(page.locator("main.feed"));
    const comingUp = await box(page.locator(".plugin-column"));
    await cards(page).and(page.locator('[data-source="sample"]')).first().locator(".card-source").click();
    const reader = await box(page.getByTestId("reader"));
    expect(Math.round(reader.x)).toBe(Math.round(feed.x));
    expect(Math.round(reader.x + reader.width)).toBe(Math.round(comingUp.x + comingUp.width));
    await expect(page.getByTestId("plugin-coming-up")).toHaveCount(0);
  });

  test("on a phone the reader fits 390 px", async ({ page }) => {
    await openFeed(page, "/", PHONE);
    await cards(page).and(page.locator('[data-source="sample"]')).first().locator(".card-source").click();
    await expect(page.getByTestId("reader")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
