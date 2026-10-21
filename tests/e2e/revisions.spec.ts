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
    const circles = sidebar(page).getByRole("navigation", { name: "Circles" }).getByRole("list").getByRole("button");
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

test.describe("item 2: content types are toggle pills", () => {
  test("several types at once, a check mark on each, click again to deselect; no checkboxes", async ({ page }) => {
    await openFeed(page);
    const types = sidebar(page).getByRole("navigation", { name: "Content type" });
    const photos = types.getByRole("button", { name: "Photos" });
    const events = types.getByRole("button", { name: "Events" });
    await expect(photos).toHaveAttribute("aria-pressed", "false");
    await expect(photos.locator(".pill-check")).toHaveCount(0);

    await photos.click();
    await events.click();
    await expect(page).toHaveURL(/type=photos%2Cevents|type=photos,events/);
    for (const pill of [photos, events]) {
      await expect(pill).toHaveAttribute("aria-pressed", "true");
      await expect(pill.locator(".pill-check")).toBeVisible();
    }
    await expect(cards(page).first()).toBeVisible();
    const kinds = new Set(await cards(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-kind"))));
    expect(kinds).toEqual(new Set(["photo", "event"]));
    // The pressed pill has the dark fill (the theme's primary color).
    const fill = await photos.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fill).toBe("rgb(20, 51, 95)"); // mosaic.css --mosaic-navy

    // A reload keeps the selection.
    await page.reload();
    await expect(types.getByRole("button", { name: "Photos" })).toHaveAttribute("aria-pressed", "true");

    // Deselecting both shows every kind again (none means All).
    await types.getByRole("button", { name: "Photos" }).click();
    await types.getByRole("button", { name: "Events" }).click();
    await expect(page).not.toHaveURL(/type=/);
    await expect
      .poll(async () => new Set(await cards(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")))).size)
      .toBeGreaterThan(2);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);

    // From the keyboard.
    await types.getByRole("button", { name: "Posts" }).focus();
    await page.keyboard.press("Enter");
    await expect(types.getByRole("button", { name: "Posts" })).toHaveAttribute("aria-pressed", "true");
  });

  test("on a phone the chip row has the same pills", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    const row = page.getByRole("group", { name: "Filters" });
    await row.getByRole("list", { name: "Content type" }).getByRole("button", { name: "Photos" }).click();
    await expect(row.getByRole("list", { name: "Content type" }).getByRole("button", { name: "Photos" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(cards(page).first()).toHaveAttribute("data-kind", "photo");
    await expect(page.locator("select")).toHaveCount(0);
  });
});

test.describe("item 3: active filter chips", () => {
  test("a chip per filter, each ✕ removes its filter, Clear all removes every one", async ({ page }) => {
    await openFeed(page);
    const active = page.getByRole("group", { name: "Active filters" });
    await expect(active).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear all" })).toHaveCount(0);

    await sidebar(page).getByRole("navigation", { name: "Circles" }).getByRole("button", { name: "Civic" }).click();
    await sidebar(page).getByRole("navigation", { name: "Content type" }).getByRole("button", { name: "Civic activity" }).click();
    await sidebar(page).getByRole("navigation", { name: "Networks" }).getByRole("button", { name: "Civic Hubs" }).click();
    const search = sidebar(page).getByRole("searchbox", { name: "Search your River" });
    await search.fill("vote");
    await search.press("Enter");
    await expect(active.getByTestId("active-filter")).toHaveText([
      "Circle: Civic",
      "Civic activity",
      "Civic Hubs",
      "Search: “vote”",
    ]);
    await expect(page).toHaveURL(/q=vote/);

    // Each ✕ removes only its own filter.
    await active.getByRole("button", { name: "Remove filter: Search: “vote”" }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(search).toHaveValue("");
    await active.getByRole("button", { name: "Remove filter: Civic Hubs" }).click();
    await expect(page).not.toHaveURL(/network=/);
    await expect(sidebar(page).getByRole("button", { name: "Civic Hubs" })).toHaveAttribute("aria-pressed", "false");
    await expect(active.getByTestId("active-filter")).toHaveText(["Circle: Civic", "Civic activity"]);

    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(active).toHaveCount(0);
    await expect(page).not.toHaveURL(/circle=|type=/);
    await expect(sidebar(page).getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(cards(page).first()).toBeVisible();
  });
});

test.describe("item 4: networks, and collapsible sections", () => {
  async function adapters(page: Page): Promise<Set<string>> {
    await expect(cards(page).first()).toBeVisible();
    return new Set(await cards(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-adapter") ?? "")));
  }

  test("Networks sits below Content type; Fediverse, Civic Hubs and both filter by network", async ({ page }) => {
    await openFeed(page);
    const headings = sidebar(page).getByRole("heading", { level: 2 });
    await expect(headings).toHaveText(["Circles", "Content type", "Networks"]);
    const networks = sidebar(page).getByRole("navigation", { name: "Networks" });
    await expect(networks.getByRole("list").getByRole("button")).toHaveText(["Civic Hubs", "Fediverse"]);
    await expect(networks).toContainText("Mastodon and compatible");

    await networks.getByRole("button", { name: "Fediverse" }).click();
    await expect(page).toHaveURL(/network=fediverse/);
    await expect.poll(() => adapters(page)).toEqual(new Set(["fediverse"]));
    await networks.getByRole("button", { name: "Civic Hubs" }).click();
    await expect.poll(() => adapters(page)).toEqual(new Set(["fediverse", "civic_hub"]));
    await networks.getByRole("button", { name: "Fediverse" }).click();
    await expect.poll(() => adapters(page)).toEqual(new Set(["civic_hub"]));
    await networks.getByRole("button", { name: "Civic Hubs" }).click();
    await expect.poll(() => adapters(page)).toContain("sample");
  });

  test("each section collapses and expands from its heading button", async ({ page }) => {
    await openFeed(page);
    for (const name of ["Circles", "Content type", "Networks"]) {
      const toggle = sidebar(page).getByRole("button", { name, exact: true });
      const section = sidebar(page).getByRole("navigation", { name });
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(section.getByRole("list")).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(section.getByRole("list")).toBeHidden();
      await toggle.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(section.getByRole("list")).toBeVisible();
    }
  });
});
