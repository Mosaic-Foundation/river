import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// M0: the Mosaic theme is the default, the Civic theme applies with data-theme="civic", and
// every font comes from the River's own origin (no requests to Google or any other host). Since
// M6 the page shows live items, whose images load straight from their source (spec 4.8); the
// fixture blocks those, and this test checks that nothing else leaves the origin.
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
}

// The browser's computed box-shadow for a token: normalized, so it doesn't depend on how the
// production build minified the CSS (e.g. rgba(20, 51, 95, 0.08) becomes #14335f14).
async function computedShadow(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const probe = document.createElement("div");
    probe.style.boxShadow = `var(${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).boxShadow;
    probe.remove();
    return value;
  }, name);
}

// Asks the browser to load the given faces (from the theme's @font-face rules), then lists the
// families that loaded, so the check doesn't race a theme switch.
async function loadedFamilies(page: Page, faces: string[]): Promise<string[]> {
  return page.evaluate(async (wanted) => {
    await Promise.all(wanted.map((face) => document.fonts.load(face)));
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""));
  }, faces);
}

test("Mosaic is the default theme, Civic swaps the tokens, fonts are self-hosted", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const fontRequests: string[] = [];
  const offOrigin: string[] = [];
  page.on("request", (req) => {
    if (req.resourceType() === "font") fontRequests.push(req.url());
    if (!req.url().startsWith(origin) && !req.url().startsWith("data:") && req.resourceType() !== "image") {
      offOrigin.push(req.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
  expect(await page.locator("html").getAttribute("data-theme")).toBe("mosaic");
  expect(await token(page, "--color-primary")).toBe("#14335f");
  expect(await computedShadow(page, "--shadow-card")).toBe("rgba(20, 51, 95, 0.08) 0px 6px 24px 0px");
  expect(await loadedFamilies(page, ['16px "Nunito Sans Variable"', '16px "Newsreader Variable"'])).toEqual(
    expect.arrayContaining(["Nunito Sans Variable", "Newsreader Variable"]),
  );

  await page.evaluate(() => (document.documentElement.dataset.theme = "civic"));
  expect(await token(page, "--color-primary")).toBe("#2a4e84");
  expect(await token(page, "--color-bg")).toBe("#f8f6f3");
  expect(await computedShadow(page, "--shadow-card")).toBe("rgba(15, 27, 45, 0.06) 0px 1px 2px 0px");
  expect(await loadedFamilies(page, ["16px Inter", '600 16px "Libre Franklin"'])).toEqual(
    expect.arrayContaining(["Inter", "Libre Franklin"]),
  );

  expect(fontRequests.length).toBeGreaterThan(0);
  expect(offOrigin).toEqual([]);
});

// Civic mode wears the Civic Hub's default theme (DECISIONS.md, 2026-10-21): navy primary,
// terracotta accent, ink text on warm paper, Libre Franklin and Inter, the hub's radii, and the
// process-type colors on civic cards. Each surface is checked as the browser renders it, axe
// checks contrast (WCAG 2 AA), and the run attaches screenshots of the feed, the reader and a
// phone to the report.
const CIVIC = {
  page: "rgb(248, 246, 243)",
  card: "rgb(255, 255, 255)",
  primary: "rgb(42, 78, 132)",
  text: "rgb(22, 36, 58)",
  heading: "rgb(12, 23, 38)",
  border: "rgb(200, 207, 219)",
};

const PROCESS_RGB: Record<string, string> = {
  vote: "rgb(21, 41, 76)",
  proposal: "rgb(95, 75, 139)",
  conversation: "rgb(15, 94, 102)",
  project: "rgb(21, 101, 192)",
  announcement: "rgb(140, 74, 43)",
  meeting: "rgb(42, 115, 64)",
  brief: "rgb(140, 74, 43)",
  wordcloud: "rgb(92, 107, 42)",
};

async function style(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);
}

async function expectAxeAA(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const issues = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(issues).toEqual([]);
}

async function attachScreenshot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await test.info().attach(name, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
}

test("Civic mode wears the Civic Hub theme on every surface, at AA contrast", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=civic");
  const cards = page.getByTestId("feed-card");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "civic");

  // Page, header, sidebar and the header's mode switch.
  expect(await style(page.locator(".page"), "background-color")).toBe(CIVIC.page);
  const header = page.locator(".topbar");
  expect(await style(header, "background-color")).toBe(CIVIC.card);
  expect(await style(header, "border-bottom-color")).toBe(CIVIC.border);
  const selectedMode = page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Civic" });
  expect(await style(selectedMode, "background-color")).toBe(CIVIC.primary);
  const sidebar = page.locator(".sidebar");
  expect(await style(sidebar, "border-top-left-radius")).toBe("18px");
  expect(await style(sidebar, "box-shadow")).toBe("rgba(15, 27, 45, 0.06) 0px 1px 2px 0px");

  // Type: Libre Franklin headings, Inter body, no Newsreader anywhere in Civic mode.
  const title = page.getByRole("heading", { level: 1, name: "Civic" });
  expect(await style(title, "font-family")).toMatch(/^"Libre Franklin"/);
  expect(await style(title, "color")).toBe(CIVIC.heading);
  expect(await style(page.locator("body"), "font-family")).toMatch(/^Inter\b/);
  expect(await style(page.locator("body"), "color")).toBe(CIVIC.text);
  expect(await token(page, "--font-heading")).not.toMatch(/newsreader/i);

  // Toggle pills: a pressed one is navy, an unpressed one sits on white with the ink border.
  const pills = page.locator(".sidebar .pill");
  await expect(pills.first()).toBeVisible();
  expect(await style(pills.first(), "border-top-left-radius")).toBe("9999px");
  expect(await style(pills.first(), "background-color")).toBe(CIVIC.card);
  expect(await style(pills.first(), "border-top-color")).toBe(CIVIC.border);
  await pills.first().click();
  await expect(pills.first()).toHaveAttribute("aria-pressed", "true");
  expect(await style(pills.first(), "background-color")).toBe(CIVIC.primary);
  const chip = page.locator(".active-filter").first();
  await expect(chip).toBeVisible();
  expect(await style(chip, "background-color")).toBe("rgb(220, 229, 242)");
  expect(await style(chip, "color")).toBe(CIVIC.primary);
  await pills.first().click();
  await expect(pills.first()).toHaveAttribute("aria-pressed", "false");

  // Cards: white, 14px corners, and a civic card's process color on its left edge and pill.
  await expect(cards.first()).toBeVisible();
  expect(await style(cards.first(), "background-color")).toBe(CIVIC.card);
  expect(await style(cards.first(), "border-top-left-radius")).toBe("14px");
  const processCard = page.locator('[data-testid="feed-card"][data-process]').first();
  await expect(processCard).toBeVisible();
  const process = (await processCard.getAttribute("data-process"))!;
  expect(Object.keys(PROCESS_RGB)).toContain(process);
  expect(await style(processCard, "border-left-width")).toBe("4px");
  expect(await style(processCard, "border-left-color")).toBe(PROCESS_RGB[process]);
  const pill = processCard.locator(".chip-process");
  await expect(pill).toBeVisible();
  expect(await style(pill, "color")).toBe(PROCESS_RGB[process]);
  expect(await style(pill, "background-color")).not.toBe(CIVIC.card); // a light tint of the hue
  expect(await style(pill, "border-top-left-radius")).toBe("9999px");

  // The civic panel's cards wear the same surface.
  const plugin = page.getByTestId("plugin-coming-up");
  expect(await style(plugin, "background-color")).toBe(CIVIC.card);
  expect(await style(plugin, "border-top-left-radius")).toBe("14px");

  // Keyboard focus: the navy outline plus the hub's soft ring.
  await page.getByRole("searchbox").first().focus();
  expect(await style(page.getByRole("searchbox").first(), "box-shadow")).toBe("rgba(62, 102, 160, 0.3) 0px 0px 0px 3px");

  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expectAxeAA(page);
  await attachScreenshot(page, "civic-feed-desktop.png");

  // The card's Open ↗ is a 10px button (ui-revisions-3 item 1).
  expect(await style(processCard.getByTestId("card-open"), "border-top-left-radius")).toBe("10px");

  // A hub item's own address: the River bar and "Open on {host} ↗" (ui-revisions-3 item 2; the
  // recordings have no hub page that allows framing), a navy 10px button.
  const processId = (await processCard.getAttribute("data-item-id"))!;
  await page.goto(`/item/${processId}?mode=civic`);
  const elsewhere = page.getByTestId("external-elsewhere");
  await expect(elsewhere).toContainText("opens in its own tab.", { timeout: 30_000 });
  const open = elsewhere.getByRole("link", { name: /^Open on / });
  expect(await style(open, "border-top-left-radius")).toBe("10px");
  expect(await style(open, "background-color")).toBe(CIVIC.primary);
  expect(await style(page.locator(".external-bar"), "background-color")).toBe(CIVIC.primary);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expectAxeAA(page);
  await attachScreenshot(page, "civic-open-desktop.png");

  // A phone: the same theme, the panel above the feed.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?mode=civic");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  expect(await style(page.locator(".page"), "background-color")).toBe(CIVIC.page);
  await expectAxeAA(page);
  await attachScreenshot(page, "civic-feed-phone.png");
});

test("Everything mode keeps the Mosaic look: no process edges or tints", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const processCard = page.locator('[data-testid="feed-card"][data-process]').first();
  await expect(processCard).toBeVisible({ timeout: 30_000 });
  expect(await style(processCard, "border-left-width")).toBe("1px");
  expect(await style(processCard, "border-left-color")).toBe("rgb(223, 228, 235)"); // --mosaic-line
  expect(await style(processCard.locator(".chip-process"), "background-color")).toBe("rgb(243, 245, 248)"); // --mosaic-mist
  expect(await style(page.locator(".page"), "background-color")).toBe("rgb(243, 245, 248)");
  expect(await style(page.locator(".button").first(), "border-top-left-radius")).toBe("9999px");
});
