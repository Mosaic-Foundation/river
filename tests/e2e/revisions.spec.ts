import AxeBuilder from "@axe-core/playwright";
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
    await expect(page.getByTestId("active-filters").getByRole("button", { name: "Clear all" })).toHaveCount(0);

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

    await page.getByTestId("active-filters").getByRole("button", { name: "Clear all" }).click();
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

test.describe("item 1: the reader view (since ui-revisions-3, only at an item's own address)", () => {
  // No click opens the reader any more (ui-revisions-3 item 2; revisions3.spec.ts checks the
  // clicks). It shows at the address of an item without a live page: a sample, or a missing one.
  async function sampleId(page: Page): Promise<string> {
    const body = (await (await page.request.get("/api/feed")).json()) as { items: Array<{ id: string; source: string }> };
    return body.items.find((i) => i.source === "sample")!.id;
  }

  test("a sample's /item/{id} shows its content, author and source beside the sidebar; Back to River goes to the feed", async ({ page }) => {
    await openFeed(page);
    const id = await sampleId(page);
    const card = page.locator(`[data-testid="feed-card"][data-item-id="${id}"]`);
    const source = (await card.locator(".card-source").textContent())!;
    await page.goto(`/item/${id}`);

    const reader = page.getByTestId("reader");
    await expect(reader).toHaveAttribute("data-item-id", id, { timeout: 30_000 });
    await expect(reader.getByTestId("reader-source")).toHaveText(source);
    await expect(reader.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(reader.locator(".reader-content").first()).not.toBeEmpty();
    await expect(reader.getByTestId("reader-author")).toContainText(/^By .+/);
    await expect(reader.getByRole("link", { name: /^Open in new tab/ })).toHaveCount(0);
    await expect(sidebar(page)).toBeVisible();
    await expect(cards(page).first()).toBeHidden();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id)).toEqual([]);

    await page.getByRole("button", { name: "Back to River" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(cards(page).first()).toBeVisible();
  });

  test("Mark read, links and the Sample label inside a card keep their own behavior; clicking a sample opens nothing", async ({ page }) => {
    await openFeed(page);
    const first = cards(page).first();
    await first.getByRole("button", { name: /^Mark (read|unread)$/ }).click();
    await expect(page.getByTestId("reader")).toHaveCount(0);
    const sample = cards(page).and(page.locator('[data-source="sample"]')).first();
    await sample.getByRole("button", { name: "Sample", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Sample entry" })).toBeVisible();
    await page.keyboard.press("Escape");
    await sample.locator(".card-text").first().click({ position: { x: 2, y: 2 } });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("reader")).toHaveCount(0);

    // A link inside a card's text opens where it points (a new tab).
    const withLink = cards(page).filter({ has: page.locator(".card-html a[href]") }).first();
    const link = withLink.locator(".card-html a[href]").first();
    await expect(link).toHaveAttribute("target", "_blank");
    const popup = page.context().waitForEvent("page");
    await link.click();
    await (await popup).close();
    await expect(page.getByTestId("reader")).toHaveCount(0);
  });

  test("an unknown item's address says so; the reader marks a sample read", async ({ page }) => {
    await openFeed(page);
    const id = await sampleId(page);
    await expect(page.locator(`[data-item-id="${id}"]`).getByTestId("unread-dot")).toBeVisible();
    await page.goto(`/item/${id}`);
    await expect(page.getByTestId("reader").getByRole("button", { name: "Mark unread" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Back to River" }).click();
    await expect(page.locator(`[data-item-id="${id}"]`).getByTestId("unread-dot")).toHaveCount(0);

    await page.goto("/item/00000000-0000-4000-8000-00000000abcd");
    await expect(page.getByTestId("reader")).toContainText("This item isn't in your River.", { timeout: 30_000 });
    await page.getByRole("button", { name: "Back to River" }).click();
    await expect(cards(page).first()).toBeVisible();
  });

  test("on a phone the reader fits 390 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    await page.goto(`/item/${await sampleId(page)}`);
    await expect(page.getByTestId("reader")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Back to River" })).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the query string survives the round trip", async ({ page }) => {
    await openFeed(page, "/?mode=civic&type=civic");
    const id = await sampleId(page);
    await page.goto(`/item/${id}?mode=civic&type=civic`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "civic", { timeout: 30_000 });
    await page.getByRole("button", { name: "Back to River" }).click();
    await expect(page).toHaveURL(/\/\?mode=civic&type=civic$/);
  });
});

test.describe("item 6: Coming up in Everything", () => {
  test("a right-hand column of upcoming dates, soonest first, whatever the filters", async ({ page }) => {
    await openFeed(page);
    const panel = page.getByRole("complementary", { name: "Everything panel" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(["Coming up"]);
    await expect(panel).toContainText("Dates from everything you follow.");
    const entries = panel.getByTestId("coming-up-entry");
    await expect(entries.first()).toBeVisible();
    const dates = await entries.locator("time").evaluateAll((els) => els.map((el) => el.getAttribute("datetime") ?? ""));
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.length).toBeLessThanOrEqual(5);
    expect(dates).toEqual([...dates].sort());
    expect(dates.every((d) => d >= "2026-10-21")).toBe(true);

    // To the right of the feed on a wide screen.
    const panelBox = (await panel.boundingBox())!;
    const feedBox = (await page.locator("main.feed").boundingBox())!;
    expect(panelBox.x).toBeGreaterThan(feedBox.x + feedBox.width - 1);

    // A filter narrows the feed, not Coming up.
    await sidebar(page).getByRole("navigation", { name: "Content type" }).getByRole("button", { name: "Photos" }).click();
    await expect(cards(page).first()).toHaveAttribute("data-kind", "photo");
    await expect
      .poll(() => entries.locator("time").evaluateAll((els) => els.map((el) => el.getAttribute("datetime") ?? "")))
      .toEqual(dates);
  });

  test("on a phone it comes after the feed", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    const panel = page.getByTestId("plugin-panel");
    await expect(panel).toBeAttached();
    const panelBox = (await panel.boundingBox())!;
    const feedBox = (await page.locator("main.feed").boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(feedBox.y + feedBox.height - 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("item 7: related hub cards are grouped", () => {
  test("one card per hub process, the latest status leading, the others folded in", async ({ page }) => {
    await openFeed(page, "/?network=hubs");
    const grouped = cards(page).filter({ has: page.getByTestId("card-group") });
    await expect(grouped.first()).toBeVisible();
    // No two cards share a hub process.
    const keys = await cards(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-item-id")));
    expect(new Set(keys).size).toBe(keys.length);
    const fromApi = (await (await page.request.get("/api/feed?network=hubs")).json()) as {
      items: Array<{ id: string; streamKey: string | null; space: { id: string }; civic: { label?: string } | null }>;
    };
    const streams = new Set(fromApi.items.map((i) => `${i.space.id} ${i.streamKey ?? i.id}`));
    expect(await cards(page).count()).toBe(streams.size);

    const card = grouped.first();
    const leadId = (await card.getAttribute("data-item-id"))!;
    const lead = fromApi.items.find((i) => i.id === leadId)!;
    const siblings = fromApi.items.filter((i) => i.streamKey === lead.streamKey && i.id !== leadId);
    expect(siblings.length).toBeGreaterThan(0);
    await expect(card).toHaveAttribute("data-group-size", String(1 + siblings.length));
    if (lead.civic?.label) await expect(card.locator(".card-chips")).toContainText(lead.civic.label);

    // The earlier updates are listed when expanded, without opening anything.
    const summary = card.getByText(siblings.length === 1 ? "1 earlier update" : `${siblings.length} earlier updates`);
    const list = card.getByRole("list", { name: "Earlier updates, newest first" });
    await expect(list).toBeHidden();
    await summary.click();
    await expect(page.getByTestId("reader")).toHaveCount(0);
    await expect(list.getByRole("listitem")).toHaveCount(siblings.length);
    for (const sibling of siblings) {
      await expect(list.locator(`[data-item-id="${sibling.id}"]`)).toContainText(sibling.civic?.label ?? "");
    }
    // From the keyboard too: an earlier update opens in the embedded view (ui-revisions-3 item 2).
    await list.getByRole("link").first().press("Enter");
    await expect(page.getByTestId("external-view")).toHaveAttribute("data-item-id", siblings[0]!.id);
  });

  test("Mark read on a group marks every item in it", async ({ page }) => {
    await openFeed(page, "/?network=hubs");
    const card = cards(page).filter({ has: page.getByTestId("card-group") }).first();
    await expect(card.getByTestId("unread-dot")).toBeVisible();
    const ids = [
      (await card.getAttribute("data-item-id"))!,
      ...(await card.locator(".card-group-item").evaluateAll((els) => els.map((el) => el.getAttribute("data-item-id")!))),
    ];
    expect(ids.length).toBeGreaterThan(1);
    await card.getByRole("button", { name: "Mark read" }).click();
    await expect(card.getByTestId("unread-dot")).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-river:read") ?? "[]") as string[]);
    expect(stored).toEqual(expect.arrayContaining(ids));
    await card.getByRole("button", { name: "Mark unread" }).click();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-river:read") ?? "[]") as string[]);
    expect(after.filter((id) => ids.includes(id))).toEqual([]);
  });
});

test.describe("reader view: audio and video from https sources (Adam, 2026-10-21)", () => {
  // The reader shows only at the address of an item without a live page (ui-revisions-3 item 2),
  // so its players are proven here by forcing the reader: the recorded fediverse video post comes
  // back without its live URL.
  test("a live video plays in the reader from its https source, loading nothing until played", async ({ page }) => {
    const media: string[] = [];
    page.on("request", (req) => {
      if (req.resourceType() === "media") media.push(req.url());
    });
    // Find a stored item with a video, then open it straight from its address.
    type Page = { items: Array<{ id: string; media: Array<{ type: string; url: string }> }>; nextCursor: string | null };
    let item: Page["items"][number] | undefined;
    let cursor: string | null = null;
    for (let n = 0; n < 20 && !item; n++) {
      const body = (await (await page.request.get(`/api/feed?network=fediverse${cursor ? `&cursor=${cursor}` : ""}`)).json()) as Page;
      item = body.items.find((i) => i.media.some((m) => m.type === "video"));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(item, "the recordings hold a fediverse post with a video").toBeTruthy();
    const video = item!.media.find((m) => m.type === "video")!;
    await page.route(`**/api/items/${item!.id}`, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { item: Record<string, unknown> };
      await route.fulfill({ response: res, json: { item: { ...body.item, url: null } } });
    });

    await page.setViewportSize(DESKTOP);
    await page.goto(`/item/${item!.id}`);
    const player = page.getByTestId("reader").getByTestId("reader-player").first();
    await expect(player).toBeVisible({ timeout: 30_000 });
    expect(await player.evaluate((el) => el.tagName)).toBe("VIDEO");
    await expect(player).toHaveAttribute("src", video.url);
    expect(new URL(video.url).protocol).toBe("https:");
    await expect(player).toHaveAttribute("controls", "");
    await expect(player).toHaveAttribute("preload", "none");
    await expect(player).toHaveAccessibleName(new RegExp(`^Video from ${new URL(video.url).host.replace(/\./g, "\\.")}`));
    await expect(page.getByTestId("reader")).not.toContainText("plays on");
    // Nothing was requested before play (the fixture also fails the test on any blocked media).
    expect(media).toEqual([]);
    const results = await new AxeBuilder({ page }).include("[data-testid=reader]").analyze();
    expect(results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id)).toEqual([]);
  });

  test("cards still show no player", async ({ page }) => {
    await openFeed(page, "/?network=fediverse");
    await expect(page.getByTestId("feed-card").locator("video, audio")).toHaveCount(0);
  });
});
