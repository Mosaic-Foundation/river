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

    // Clicking a selected circle turns it off; All clears the rest.
    await circle(page, "Family").click();
    await expectPressed(page, ["News and ideas"]);
    await expect(page).toHaveURL(/\?circle=News\+and\+ideas&type=articles$/);
    await circle(page, "All").click();
    await expectPressed(page, []);
    await expect(page).toHaveURL(/\?type=articles$/);
  });

  test("the URL carries the circles: a link opens the same selection, and it survives Back", async ({ page }) => {
    await openFeed(page, "/?circle=Family&circle=Soccer");
    await expectPressed(page, ["Family", "Soccer"]);
    const both = await allIds(page, "circle=Family&circle=Soccer");
    for (const id of await shownIds(page)) expect(both.has(id)).toBe(true);

    await page.goto("/following");
    await expect(page).toHaveURL(/\/following/);
    await page.goBack();
    await expect(page).toHaveURL(/\?circle=Family&circle=Soccer$/);
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    await expectPressed(page, ["Family", "Soccer"]);
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
