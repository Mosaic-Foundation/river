import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 4 (docs/spec/ui-revisions-4.md), one describe block per item. The API replays
// recorded responses; nothing leaves loopback (fixtures.ts).

const DESKTOP = { width: 1440, height: 1000 };
const PHONE = { width: 390, height: 844 };

interface ApiItem {
  id: string;
  kind: string;
}

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

function sidebar(page: Page): Locator {
  return page.getByRole("complementary", { name: "Filters" });
}

function circleButtons(page: Page): Locator {
  return sidebar(page).getByRole("navigation", { name: "Circles" }).getByRole("list").getByRole("button");
}

function circle(page: Page, name: string): Locator {
  return circleButtons(page).filter({ hasText: new RegExp(`^${name}$`) });
}

async function openFeed(page: Page, path = "/", viewport: { width: number; height: number } = DESKTOP): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
}

/** The ids of every item the visitor's feed has for `query`, following its pages. */
async function allIds(page: Page, query: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (let n = 0; n < 50; n++) {
    const res = await page.request.get(`/api/feed?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    const body = (await res.json()) as { items: ApiItem[]; nextCursor: string | null };
    for (const item of body.items) ids.add(item.id);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return ids;
}

async function shownIds(page: Page): Promise<string[]> {
  return cards(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-item-id") ?? ""));
}

async function expectPressed(page: Page, names: string[]): Promise<void> {
  const all = await circleButtons(page).allTextContents();
  for (const name of all) {
    const pressed = names.includes(name) || (names.length === 0 && name === "All");
    await expect(circle(page, name), name).toHaveAttribute("aria-pressed", String(pressed));
    await expect(circle(page, name).locator(".filter-option-check"), name).toHaveCount(pressed ? 1 : 0);
  }
}

test.describe("item 1: circles are multi-select", () => {
  test("two circles show items from either; a type narrows them; All clears", async ({ page }) => {
    await openFeed(page);
    const family = await allIds(page, "circle=Family");
    const news = await allIds(page, "circle=News+and+ideas");

    await circle(page, "Family").click();
    await circle(page, "News and ideas").click();
    await expectPressed(page, ["Family", "News and ideas"]);
    await expect(page).toHaveURL(/\?circle=News\+and\+ideas&circle=Family$/);
    await expect(cards(page).first()).toBeVisible();
    await expect.poll(async () => (await shownIds(page)).every((id) => family.has(id) || news.has(id))).toBe(true);
    const shown = await shownIds(page);
    expect(shown.some((id) => family.has(id))).toBe(true);
    expect(shown.some((id) => news.has(id))).toBe(true);

    // Family + News and ideas + Articles: articles from either circle.
    await sidebar(page).getByRole("button", { name: "Articles" }).click();
    await expect(page).toHaveURL(/circle=Family&type=articles$/);
    await expect(cards(page).first()).toBeVisible();
    await expect(page.locator('[data-testid="feed-card"]:not([data-kind="article"])')).toHaveCount(0);
    for (const id of await shownIds(page)) expect(family.has(id) || news.has(id)).toBe(true);

    // Clicking a selected circle turns it off, and on again.
    await circle(page, "Family").click();
    await expectPressed(page, ["News and ideas"]);
    await expect(page).toHaveURL(/\?circle=News\+and\+ideas&type=articles$/);
    await circle(page, "Family").click();
    await expectPressed(page, ["Family", "News and ideas"]);

    // All clears both: every article shows, from any circle.
    await circle(page, "All").click();
    await expectPressed(page, []);
    await expect(page).toHaveURL(/\?type=articles$/);
    const articles = ((await (await page.request.get("/api/feed?type=articles")).json()) as { items: ApiItem[] }).items;
    await expect.poll(() => shownIds(page)).toEqual(articles.map((i) => i.id));
  });

  test("the URL carries the circles: a link opens the same selection, and it survives opening an item and Back", async ({ page }) => {
    // Hub pages answer the framing check as allowing it (a stand-in, as in revisions3.spec.ts), so
    // a hub card opens inside the River at /item/{id}.
    await page.route("**/api/items/*/frame", (route) => route.fulfill({ json: { frame: { url: "https://longmont.civic.social/stand-in" } } }));
    await openFeed(page, "/?circle=Civic&circle=Family");
    await expectPressed(page, ["Civic", "Family"]);
    const both = await allIds(page, "circle=Civic&circle=Family");
    for (const id of await shownIds(page)) expect(both.has(id)).toBe(true);

    const hub = page.locator('[data-testid="feed-card"][data-adapter="civic_hub"]').first();
    await expect(hub).toHaveAttribute("data-open", "frame");
    const id = (await hub.getAttribute("data-item-id"))!;
    await hub.locator(".card-source").click();
    await expect(page).toHaveURL(new RegExp(`/item/${id}\\?circle=Civic&circle=Family$`));
    await expect(page.getByTestId("external-frame")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/\?circle=Civic&circle=Family$/);
    await expect(cards(page).first()).toBeVisible();
    await expectPressed(page, ["Civic", "Family"]);

    // Leaving the River and coming Back keeps them too.
    await page.goto("/following");
    await page.goBack();
    await expect(page).toHaveURL(/\/\?circle=Civic&circle=Family$/);
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    await expectPressed(page, ["Civic", "Family"]);
  });

  test("circles toggle from the keyboard", async ({ page }) => {
    await openFeed(page);
    await circle(page, "Family").focus();
    await page.keyboard.press("Enter");
    await expectPressed(page, ["Family"]);
    await circle(page, "Soccer").focus();
    await page.keyboard.press("Space");
    await expectPressed(page, ["Family", "Soccer"]);
    await page.keyboard.press("Space");
    await expectPressed(page, ["Family"]);
  });

  test("Civic mode lists only the civic circle and keeps only civic circles on", async ({ page }) => {
    await openFeed(page);
    await circle(page, "Civic").click();
    await circle(page, "Family").click();
    await expectPressed(page, ["Civic", "Family"]);
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Civic" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "civic");
    await expect(circleButtons(page)).toHaveText(["All", "Civic"]);
    await expectPressed(page, ["Civic"]);
    await expect(page).toHaveURL(/\?mode=civic&circle=Civic$/);
    await circle(page, "All").click();
    await expectPressed(page, []);
    await expect(page).toHaveURL(/\?mode=civic$/);
  });

  test("on a phone the chip row toggles circles the same way", async ({ page }) => {
    await openFeed(page, "/", PHONE);
    const chips = page.getByRole("group", { name: "Filters" }).getByRole("list", { name: "Circles" });
    const chip = (name: string) => chips.getByRole("button", { name, exact: true });
    await chip("Family").click();
    await chip("Soccer").click();
    await expect(chip("Family")).toHaveAttribute("aria-pressed", "true");
    await expect(chip("Soccer")).toHaveAttribute("aria-pressed", "true");
    await expect(chip("All")).toHaveAttribute("aria-pressed", "false");
    await expect(chip("Family").locator(".pill-check")).toHaveCount(1);
    await expect(page).toHaveURL(/\?circle=Family&circle=Soccer$/);
    const both = await allIds(page, "circle=Family&circle=Soccer");
    await expect(cards(page).first()).toBeVisible();
    for (const id of await shownIds(page)) expect(both.has(id)).toBe(true);
    await chip("All").click();
    await expect(chip("All")).toHaveAttribute("aria-pressed", "true");
    await expect(chip("Family")).toHaveAttribute("aria-pressed", "false");
    await expect(page).not.toHaveURL(/circle=/);
  });
});

/**
 * Adds stand-in circles to the feed's answer, so the visitor's five circles become more. Only the
 * column's layout is checked with them; clicking one would ask the API for a circle it doesn't
 * know.
 */
async function extraCircles(page: Page, count: number): Promise<void> {
  await page.route((url) => url.pathname === "/api/feed", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { circles: Array<{ id: string; name: string; color: string | null; role: null }> };
    for (let n = 1; n <= count; n++) body.circles.push({ id: `Extra ${n}`, name: `Extra ${n}`, color: null, role: null });
    await route.fulfill({ response, json: body });
  });
}

test.describe("item 2: six circles, then the section scrolls", () => {
  test("with more than six circles the list shows six rows, scrolls to the last, and says so", async ({ page }) => {
    await extraCircles(page, 3);
    await openFeed(page);
    const scroll = page.getByTestId("circle-scroll");
    const rows = scroll.getByRole("button");
    await expect(rows).toHaveCount(8);
    const row = (await rows.first().boundingBox())!.height;
    const box = (await scroll.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(row * 6 + 2);
    expect(box.height).toBeGreaterThanOrEqual(row * 6 - 2);
    expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(page.getByTestId("circle-scroll-hint")).toHaveText("Scroll for more circles");
    await expect(page.getByTestId("circle-scroll-hint")).toBeVisible();

    // The last circle is reached by scrolling the section; All stays above it.
    const last = rows.last();
    await last.scrollIntoViewIfNeeded();
    const lastBox = (await last.boundingBox())!;
    const after = (await scroll.boundingBox())!;
    expect(await scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(after.y + after.height + 1);
    await expect(circle(page, "All")).toBeInViewport();

    // The column itself keeps its own scroll (ui-revisions-3 item 4).
    expect(await page.locator(".filter-column").evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
  });

  test("with six circles or fewer there's no inner scroll and no hint", async ({ page }) => {
    await extraCircles(page, 1);
    await openFeed(page);
    const scroll = page.getByTestId("circle-scroll");
    await expect(scroll.getByRole("button")).toHaveCount(6);
    expect(await scroll.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    await expect(page.getByTestId("circle-scroll-hint")).toHaveCount(0);
  });
});

test.describe("item 3: the filter column's title", () => {
  for (const mode of ["everything", "civic"]) {
    test(`"Filter your River" heads the column in ${mode}`, async ({ page }) => {
      await openFeed(page, mode === "civic" ? "/?mode=civic" : "/");
      const title = sidebar(page).getByRole("heading", { level: 2 });
      await expect(title).toHaveText("Filter your River");
      expect(await sidebar(page).evaluate((el) => el.children[0]?.textContent)).toBe("Filter your River");
      const titleBox = (await title.boundingBox())!;
      const searchBox = (await sidebar(page).getByRole("searchbox").boundingBox())!;
      expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(searchBox.y);
    });
  }
});

test.describe("item 4: a compact Clear all", () => {
  for (const mode of ["everything", "civic"]) {
    test(`one line, at most 32 px tall, in the primary colour, only with a filter on (${mode})`, async ({ page }) => {
      await openFeed(page, mode === "civic" ? "/?mode=civic" : "/");
      const clear = sidebar(page).getByRole("button", { name: "Clear all" });
      await expect(clear).toHaveCount(0);
      const pill = sidebar(page).getByRole("button", { name: "Articles" });
      await pill.click();
      await expect(clear).toBeVisible();
      const box = (await clear.boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(32);
      const lineHeight = await clear.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      const padding = await clear.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop) * 2 + parseFloat(getComputedStyle(el).borderTopWidth) * 2);
      expect(box.height).toBeLessThan(lineHeight * 2 + padding); // one line of text
      // A pressed pill wears the primary colour; Clear all's border and text are that colour.
      const primary = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(await clear.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(primary);
      expect(await clear.evaluate((el) => getComputedStyle(el).color)).toBe(primary);

      await clear.click();
      await expect(page).toHaveURL(mode === "civic" ? /\/\?mode=civic$/ : /\/$/);
      await expect(clear).toHaveCount(0);
    });
  }
});

test.describe("item 5: no active-filter chips above the feed", () => {
  test("filters on show no chips; the unread count and sort line stay", async ({ page }) => {
    await openFeed(page, "/?circle=Family&circle=Civic&q=a");
    await sidebar(page).getByRole("button", { name: "Civic Hubs" }).click();
    await expect(page).toHaveURL(/network=hubs/);
    await expect(sidebar(page).getByRole("button", { name: "Clear all" })).toBeVisible();
    await expect(page.getByTestId("active-filters")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Active filters" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove filter/ })).toHaveCount(0);
    await expect(page.locator(".feed-summary")).toHaveText(/^\d+ unread · newest first$/);
  });

  test("on a phone Clear all sits first in the chip row and clears every filter", async ({ page }) => {
    await openFeed(page, "/", PHONE);
    const row = page.getByRole("group", { name: "Filters" });
    const clear = row.getByRole("button", { name: "Clear all" });
    await expect(clear).toHaveCount(0);
    await row.getByRole("list", { name: "Circles" }).getByRole("button", { name: "Family", exact: true }).click();
    await row.getByRole("list", { name: "Content type" }).getByRole("button", { name: "Photos" }).click();
    await expect(page).toHaveURL(/\?circle=Family&type=photos$/);
    await expect(clear).toBeVisible();
    expect((await clear.boundingBox())!.height).toBeLessThanOrEqual(32);
    expect(await row.evaluate((el) => el.children[0]?.textContent)).toBe("Clear all");
    await expect(page.getByTestId("active-filters")).toHaveCount(0);
    await expect(page.locator(".feed-summary")).toHaveText(/unread · newest first$/);
    await clear.focus();
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/circle=|type=/);
    await expect(clear).toHaveCount(0);
    await expect(row.getByRole("list", { name: "Circles" }).getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
});
