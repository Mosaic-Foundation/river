import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// UI revisions 6 (docs/spec/ui-revisions-6.md): the phone's filter button and bottom sheet, one
// describe block per item, all at a phone viewport. The API replays recorded responses; nothing
// leaves loopback (fixtures.ts).

const PHONE = { width: 390, height: 844 };

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

function button(page: Page): Locator {
  return page.getByTestId("filter-button");
}

function sheet(page: Page): Locator {
  return page.getByRole("dialog", { name: "Filter your River" });
}

function section(page: Page, name: string): Locator {
  return sheet(page).getByRole("navigation", { name });
}

function pill(page: Page, sectionName: string, name: string): Locator {
  return section(page, sectionName).getByRole("button", { name, exact: true });
}

async function openFeed(page: Page, path = "/"): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
}

async function openSheet(page: Page): Promise<void> {
  await button(page).click();
  await expect(sheet(page)).toBeVisible();
  // Let the slide-in finish, so boxes and taps land where the sheet rests.
  await page.getByTestId("filter-sheet").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

/** The ids of every item the visitor's feed has for `query`, following its pages. */
async function allIds(page: Page, query: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (let n = 0; n < 50; n++) {
    const res = await page.request.get(`/api/feed?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    const body = (await res.json()) as { items: Array<{ id: string }>; nextCursor: string | null };
    for (const item of body.items) ids.add(item.id);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return ids;
}

async function shownIds(page: Page): Promise<string[]> {
  return cards(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-item-id") ?? ""));
}

test.describe("item 1: one filter button", () => {
  test("no chip strip; a full-width button that reads Filter your River", async ({ page }) => {
    await openFeed(page);
    await expect(page.locator(".chip-row")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Filters" })).toHaveCount(0);
    await expect(button(page)).toBeVisible();
    await expect(button(page)).toHaveAttribute("aria-haspopup", "dialog");
    await expect(button(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("filter-button-title")).toHaveText("Filter your River");
    await expect(page.getByTestId("filter-summary")).toHaveCount(0);
    const box = (await button(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(PHONE.width - 48);
  });

  test("with filters on it shows the count and a one-line summary", async ({ page }) => {
    await openFeed(page, "/?circle=Family&circle=News+and+ideas&type=articles");
    await expect(page.getByTestId("filter-count")).toHaveText("3");
    await expect(button(page)).toContainText("Filter your River · 3");
    await expect(button(page)).toHaveAccessibleName(/Filter your River · 3 filters on/);
    const summary = page.getByTestId("filter-summary");
    await expect(summary).toHaveText("Family, News and ideas · Articles");
    const lines = await summary.evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
    expect(lines).toBeLessThan(1.5);

    // A long selection is cut to one line, not wrapped (it matches nothing, so no card shows).
    await page.goto("/?circle=Family&circle=News+and+ideas&circle=Soccer&circle=Neighborhood&type=articles,posts,photos&network=hubs&q=library");
    await expect(page.getByTestId("filter-count")).toHaveText("9");
    const cut = await page.getByTestId("filter-summary").evaluate((el) => ({
      lines: el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
      overflowing: el.scrollWidth > el.clientWidth,
      ellipsis: getComputedStyle(el).textOverflow,
    }));
    expect(cut.lines).toBeLessThan(1.5);
    expect(cut.overflowing).toBe(true);
    expect(cut.ellipsis).toBe("ellipsis");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe("item 2: the bottom sheet", () => {
  test("most of the screen, a drag handle, the column's content as wrapping pills", async ({ page }) => {
    await openFeed(page);
    await openSheet(page);
    await expect(button(page)).toHaveAttribute("aria-expanded", "true");
    const box = (await sheet(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(PHONE.height * 0.75);
    expect(box.height).toBeLessThanOrEqual(PHONE.height);
    expect(box.y + box.height).toBeCloseTo(PHONE.height, 0);
    await expect(sheet(page).getByTestId("filter-sheet-handle")).toBeVisible();

    await expect(sheet(page).getByRole("heading", { level: 2 })).toHaveText("Filter your River");
    await expect(sheet(page).getByRole("searchbox", { name: "Search your River" })).toBeVisible();
    await expect(sheet(page).getByRole("heading", { level: 3 })).toHaveText(["Circles", "Content type", "Networks", "Source"]);
    await expect(section(page, "Circles").getByRole("list").getByRole("button")).toHaveText([
      "All",
      "Civic",
      "News and ideas",
      "Family",
      "Soccer",
      "Neighborhood",
    ]);
    await expect(section(page, "Content type").getByRole("list").getByRole("button")).toHaveCount(7);
    await expect(section(page, "Networks").getByRole("list").getByRole("button")).toHaveText(["Civic Hubs", "Fediverse", "Bluesky"]);

    // Nothing scrolls sideways; the pills wrap onto several lines.
    const sideways = await sheet(page).evaluate((root) =>
      [root, ...root.querySelectorAll<HTMLElement>("*")].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "hidden").length,
    );
    expect(sideways).toBe(0);
    const rows = await section(page, "Content type").getByRole("list").getByRole("button").evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
    expect(rows).toBeGreaterThan(1);
    const sheetBox = (await sheet(page).boundingBox())!;
    for (const el of await sheet(page).getByRole("button").all()) {
      const b = await el.boundingBox();
      if (b) expect(b.x + b.width).toBeLessThanOrEqual(sheetBox.x + sheetBox.width + 1);
    }

    // The body scrolls inside the sheet; Show results stays at the bottom.
    const done = sheet(page).getByRole("button", { name: "Show results" });
    const before = (await done.boundingBox())!;
    await sheet(page).locator(".filter-sheet-body").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    expect((await done.boundingBox())!.y).toBe(before.y);
    expect(before.y + before.height).toBeLessThanOrEqual(PHONE.height);
  });
});

test.describe("item 3: live filters, and every way to close", () => {
  test("toggling updates the feed behind the sheet; Show results keeps the selections", async ({ page }) => {
    await openFeed(page);
    const family = await allIds(page, "circle=Family");
    await openSheet(page);
    await pill(page, "Circles", "Family").click();
    await expect(pill(page, "Circles", "Family")).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/\?circle=Family$/);
    // The feed behind the open sheet already shows only Family.
    await expect(sheet(page)).toBeVisible();
    await expect.poll(async () => (await shownIds(page)).every((id) => family.has(id))).toBe(true);

    await sheet(page).getByRole("button", { name: "Show results" }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(page).toHaveURL(/\?circle=Family$/);
    await expect(page.getByTestId("filter-count")).toHaveText("1");
    await expect(page.getByTestId("filter-summary")).toHaveText("Family");
  });

  test("Back, a tap outside and a swipe down each close it and keep the selections", async ({ page }) => {
    await openFeed(page);

    // The back gesture.
    await openSheet(page);
    await pill(page, "Content type", "Articles").click();
    await expect(page).toHaveURL(/\?type=articles$/);
    await page.goBack();
    await expect(sheet(page)).toBeHidden();
    await expect(page).toHaveURL(/\/\?type=articles$/);
    await expect(page.getByTestId("filter-summary")).toHaveText("Articles");

    // A tap outside, on the backdrop above the sheet.
    await openSheet(page);
    await pill(page, "Networks", "Civic Hubs").click();
    await page.mouse.click(PHONE.width / 2, 20);
    await expect(sheet(page)).toBeHidden();
    await expect(page).toHaveURL(/\?type=articles&network=hubs$/);

    // A swipe down on the handle; a short drag snaps back instead.
    await openSheet(page);
    const handle = (await sheet(page).getByTestId("filter-sheet-handle").boundingBox())!;
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 3 });
    await page.mouse.up();
    await expect(sheet(page)).toBeVisible();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(sheet(page)).toBeHidden();
    await expect(page).toHaveURL(/\?type=articles&network=hubs$/);
    await expect(page.getByTestId("filter-count")).toHaveText("2");

    // Closing stepped back over the sheet's entry. Forward onto it leaves the sheet closed and
    // the filters as they are, and unmarks it: the next open and close steps back only once.
    const sheetEntry = () => page.evaluate(() => (window.history.state as { riverSheet?: boolean } | null)?.riverSheet ?? false);
    expect(await sheetEntry()).toBe(false);
    await page.goForward();
    await expect(sheet(page)).toBeHidden();
    await expect(page).toHaveURL(/\?type=articles&network=hubs$/);
    expect(await sheetEntry()).toBe(false);
    // Mark this entry: closing with Back must land back on it (one step back, not two).
    await page.evaluate(() => window.history.replaceState({ ...(window.history.state as object), mark: "here" }, ""));
    await openSheet(page);
    await page.goBack();
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => page.evaluate(() => (window.history.state as { mark?: string } | null)?.mark)).toBe("here");
    await expect(page).toHaveURL(/\?type=articles&network=hubs$/);

    // Keyboard on the handle closes it, even right after a drag that snapped back.
    await openSheet(page);
    const grip = (await sheet(page).getByTestId("filter-sheet-handle").boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 30, { steps: 3 });
    await page.mouse.up();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByTestId("filter-sheet-handle").press("Enter");
    await expect(sheet(page)).toBeHidden();
  });

  test("Clear all resets every filter and the sheet stays open", async ({ page }) => {
    await openFeed(page, "/?circle=Family&type=photos&q=garden");
    await openSheet(page);
    await sheet(page).getByRole("button", { name: "Clear all" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(sheet(page)).toBeVisible();
    await expect(pill(page, "Circles", "All")).toHaveAttribute("aria-pressed", "true");
    await expect(sheet(page).locator("[aria-pressed=true]")).toHaveCount(1);
    await expect(sheet(page).getByRole("searchbox")).toHaveValue("");
    await expect(sheet(page).getByRole("button", { name: "Clear all" })).toHaveCount(0);
    await sheet(page).getByRole("button", { name: "Show results" }).click();
    await expect(page.getByTestId("filter-count")).toHaveCount(0);
  });

  test("Civic mode works the same and keeps the mode", async ({ page }) => {
    await openFeed(page, "/?mode=civic");
    await openSheet(page);
    await expect(section(page, "Circles").getByRole("list").getByRole("button")).toHaveText(["All", "Civic"]);
    await pill(page, "Circles", "Civic").click();
    await pill(page, "Content type", "Civic activity").click();
    await expect(page).toHaveURL(/\?mode=civic&circle=Civic&type=civic$/);
    await sheet(page).getByRole("button", { name: "Clear all" }).click();
    await expect(page).toHaveURL(/\?mode=civic$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "civic");
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByTestId("topbar-title")).toHaveText("Citizen Dashboard");
  });
});

test.describe("item 4: accessibility", () => {
  test("a modal dialog named by its title; focus in on open and back on Escape", async ({ page }) => {
    await openFeed(page);
    await openSheet(page);
    await expect(page.getByTestId("filter-sheet")).toHaveAttribute("aria-modal", "true");
    expect(await page.getByTestId("filter-sheet").evaluate((el) => el.tagName)).toBe("DIALOG");
    expect(await page.evaluate(() => document.activeElement?.closest("dialog")?.getAttribute("data-testid"))).toBe("filter-sheet");
    // showModal() makes the page behind inert: a click there lands on the sheet's backdrop.
    expect(await page.evaluate(() => document.querySelector("dialog.filter-sheet")?.matches(":modal"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect(button(page)).toBeFocused();
    await expect(button(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("Tab reaches every control, and they work from the keyboard", async ({ page }) => {
    await openFeed(page);
    await button(page).focus();
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    const expected = await sheet(page).locator("button:visible, input:visible").count();
    const reached = new Set<string>();
    for (let n = 0; n < expected + 4; n++) {
      reached.add(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          // Past the last control, Tab visits the browser's own UI (the body here) and comes back.
          if (el === document.body) return "browser";
          return el.closest("dialog") ? `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""}` : "outside";
        }),
      );
      await page.keyboard.press("Tab");
    }
    expect(reached.has("outside")).toBe(false);
    reached.delete("browser");
    expect(reached.size).toBeGreaterThanOrEqual(expected);
    for (const name of ["BUTTON:Close filters", "BUTTON:Family", "BUTTON:Articles", "BUTTON:Fediverse", "BUTTON:Show results"]) {
      expect([...reached]).toContain(name);
    }

    await pill(page, "Circles", "Soccer").focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/\?circle=Soccer$/);
    const search = sheet(page).getByRole("searchbox", { name: "Search your River" });
    await search.fill("match");
    await search.press("Enter");
    await expect(page).toHaveURL(/\?circle=Soccer&q=match$/);
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole("button", { name: "Show results" }).press("Enter");
    await expect(sheet(page)).toBeHidden();
    await expect(button(page)).toBeFocused();
  });

  test("reduced motion: the sheet opens without its slide", async ({ page }) => {
    await openFeed(page);
    await openSheet(page);
    expect(await page.getByTestId("filter-sheet").evaluate((el) => getComputedStyle(el).animationName)).toBe("filter-sheet-in");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSheet(page);
    expect(await page.getByTestId("filter-sheet").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });

  test("axe finds no serious issue with the sheet open, in both modes", async ({ page }) => {
    for (const path of ["/?circle=Family", "/?mode=civic"]) {
      await openFeed(page, path);
      await openSheet(page);
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
      expect(serious).toEqual([]);
    }
  });
});
