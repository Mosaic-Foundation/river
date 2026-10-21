import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { identityURL } from "../../playwright.config";
import { expect, test } from "./fixtures";
import { addAuthenticator, resetLimits, setClock, testEmail, throughCallback, withAdmin } from "./identityHelpers";

// M10, Modes and plugins (spec F9, 4.7; checks 7 and 8, and 30/31 for Civic mode). The API replays
// recorded hub feeds with its clock at TEST_CLOCK_NOW (2026-10-21), so Coming up lists the
// recorded Longmont vote's voting_closes_at (2026-11-08) whatever day the tests run. Nothing
// leaves loopback (fixtures.ts).

const SEED_INSTANCE = "00000000-0000-4000-8000-000000000001";
const LONGMONT_DEADLINE = "2026-11-08T05:00:47.238Z";
const CIVIC_PRIMARY = "#386759"; // civic.css --civic-green
const MOSAIC_PRIMARY = "#14335f"; // mosaic.css --mosaic-navy

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

function modeSwitch(page: Page): Locator {
  return page.getByRole("group", { name: "Mode" });
}

async function primary(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim());
}

async function expectTheme(page: Page, theme: "mosaic" | "civic"): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  expect(await primary(page)).toBe(theme === "civic" ? CIVIC_PRIMARY : MOSAIC_PRIMARY);
}

/** Names of the spaces whose category is civic, from the reader's own Everything feed. */
async function civicSpaceNames(page: Page): Promise<Set<string>> {
  return new Set(await civicSpaceNameList(page));
}

async function civicSpaceNameList(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = new Set<string>();
    let cursor: string | null = null;
    for (let n = 0; n < 100; n++) {
      const params = new URLSearchParams(cursor ? { mode: "everything", cursor } : { mode: "everything" });
      const body = (await (await fetch(`/api/feed?${params}`)).json()) as {
        items: Array<{ space: { name: string; category: string | null } }>;
        nextCursor: string | null;
      };
      for (const item of body.items) if (item.space.category === "civic") names.add(item.space.name);
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    return [...names]; // a Set doesn't cross back from the page
  });
}

/** Checks the Civic panel: Coming up in date order with the recorded deadline, then the slots. */
async function expectCivicPanel(page: Page): Promise<void> {
  const panel = page.getByRole("complementary", { name: "Civic panel" });
  await expect(panel).toBeVisible();
  const headings = panel.getByRole("heading", { level: 2 });
  await expect(headings).toHaveText(["Coming up", "Your representatives", "Elections and ballot"]);

  const comingUp = panel.getByTestId("plugin-coming-up");
  const entries = comingUp.getByTestId("coming-up-entry");
  await expect(entries.first()).toBeVisible();
  const dates = await entries.locator("time").evaluateAll((els) => els.map((el) => el.getAttribute("datetime") ?? ""));
  expect(dates.length).toBeGreaterThan(0);
  expect(dates.length).toBeLessThanOrEqual(5);
  expect(dates).toEqual([...dates].sort());
  expect(dates).toContain(LONGMONT_DEADLINE);
  await expect(entries.filter({ hasText: "Voting closes · Longmont Civic Hub" })).toHaveCount(1);
  // A live entry links to its item, in a new tab, like a card's Open link.
  const link = entries.filter({ hasText: "Longmont Civic Hub" }).getByRole("link");
  await expect(link).toHaveAttribute("href", /^https:\/\/longmont\.civic\.social\//);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);

  await expect(panel.getByTestId("plugin-your-representatives")).toContainText(
    "Waiting on a data source (Open States, Geocodio or Cicero).",
  );
  await expect(panel.getByTestId("plugin-elections-and-ballot")).toContainText(
    "Waiting on a data source (Democracy Works or Ballotpedia).",
  );
}

/** Every card on the page comes from one of these spaces. */
async function expectOnlyFrom(page: Page, names: Set<string>): Promise<void> {
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  const sources = await cards(page).locator(".card-source").allTextContents();
  expect(sources.length).toBeGreaterThan(0);
  for (const source of sources) expect([...names], source).toContain(source.trim());
}

async function expectNoSeriousAxeIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(serious).toEqual([]);
}

test("check 7: Civic mode shows only civic items, wears the Civic theme and shows the panel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  await expectTheme(page, "mosaic");
  await expect(modeSwitch(page).getByRole("button", { name: "Everything" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("plugin-panel")).toHaveCount(0); // Everything: no panel
  await expect(cards(page).getByRole("button", { name: "Sample", exact: true }).first()).toBeVisible();
  const civicNames = await civicSpaceNames(page);
  expect(civicNames.size).toBe(3); // the three seed hubs

  await modeSwitch(page).getByRole("button", { name: "Civic" }).click();
  await expect(modeSwitch(page).getByRole("button", { name: "Civic" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { level: 1, name: "Civic" })).toBeVisible();
  await expectTheme(page, "civic");
  await expect(page).toHaveURL(/[?&]mode=civic\b/);
  await expectCivicPanel(page);
  await expectOnlyFrom(page, civicNames);
  await expect(cards(page).getByRole("button", { name: "Sample", exact: true })).toHaveCount(0);
  await expectNoSeriousAxeIssues(page);

  // The panel sits beside the feed on a wide screen.
  const panelBox = (await page.getByTestId("plugin-panel").boundingBox())!;
  const feedBox = (await page.locator("main.feed").boundingBox())!;
  expect(panelBox.x).toBeGreaterThan(feedBox.x + feedBox.width - 1);

  // A reload keeps the mode; the switch takes it back to Everything.
  await page.reload();
  await expectTheme(page, "civic");
  await expectCivicPanel(page);
  await modeSwitch(page).getByRole("button", { name: "Everything" }).click();
  await expect(page.getByTestId("plugin-panel")).toHaveCount(0);
  await expectTheme(page, "mosaic");
  await expect(page).not.toHaveURL(/mode=/);
  await expect(page.getByRole("heading", { level: 1, name: "Everything" })).toBeVisible();
});

test("check 7 on a phone: the header's mode picker, the panel above the feed, no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(modeSwitch(page)).toBeVisible();
  await modeSwitch(page).getByRole("button", { name: "Civic" }).click();
  await expectTheme(page, "civic");
  await expectCivicPanel(page);
  const panelBox = (await page.getByTestId("plugin-panel").boundingBox())!;
  const feedBox = (await cards(page).first().boundingBox())!;
  expect(panelBox.y).toBeLessThan(feedBox.y);
  // Check 30 still holds in Civic mode: no horizontal page scroll, tabs and filters reachable.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole("navigation", { name: "River sections" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Filters" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

test("check 7, member: Civic reads the circle whose role is civic, renamed or not", async ({ page, request }) => {
  await resetLimits(request);
  await setClock(request, 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await addAuthenticator(page);
  await page.goto("/");
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/api/auth/signin");
  await page.waitForURL(`${identityURL}/authorize?**`);
  await page.getByLabel("Email address").fill(testEmail("modes"));
  await page.getByRole("button", { name: "Create a passkey" }).click();
  await throughCallback(page, () => page.getByRole("link", { name: "Continue to Mosaic River" }).click());
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  // A member's River is their own: no Sample River line (ui-revisions-1 item 8).
  await expect(page.getByTestId("sample-banner")).toHaveCount(0);
  const civicNames = await civicSpaceNames(page);

  // Civic before: the hubs only (the campaign sample is followed but in no circle).
  await modeSwitch(page).getByRole("button", { name: "Civic" }).click();
  await expectTheme(page, "civic");
  await expectCivicPanel(page);
  await expectOnlyFrom(page, civicNames);

  // The Following link keeps the mode, and the page wears its theme.
  await page.getByRole("link", { name: "Following", exact: true }).click();
  await expect(page).toHaveURL(/\/following\?mode=civic$/);
  await expect(page.getByTestId("space-row").first()).toBeVisible({ timeout: 30_000 });
  await expectTheme(page, "civic");

  // Rename the Civic circle and put the campaign sample in it.
  const circles = page.getByRole("complementary", { name: "Circles" });
  const civic = circles.getByTestId("circle-row").filter({ hasText: /^Civic/ });
  await civic.getByRole("button", { name: "Edit Civic" }).click();
  await civic.getByRole("checkbox", { name: "Safe Streets for Millbrook" }).click();
  await expect(civic.getByRole("checkbox", { name: "Safe Streets for Millbrook" })).toBeChecked();
  await civic.getByLabel("Name").fill("Our town");
  await civic.getByRole("button", { name: "Save" }).click();
  await expect(circles.getByTestId("circle-row").filter({ hasText: "Our town" })).toBeVisible();

  // Back in Civic mode, the renamed circle's new member shows beside the hubs.
  await page.getByRole("link", { name: "Back to your River" }).click();
  await expect(page).toHaveURL(/\/\?mode=civic$/);
  await expectTheme(page, "civic");
  await expect(cards(page).filter({ hasText: "Safe Streets for Millbrook" }).first()).toBeVisible({ timeout: 30_000 });
  await expectOnlyFrom(page, new Set([...civicNames, "Safe Streets for Millbrook"]));
  // Circles work in every mode: Civic AND the "Our town" circle is that circle's members.
  await page.getByRole("complementary", { name: "Filters" }).getByRole("button", { name: "Our town" }).click();
  await expect(page).toHaveURL(/circle=/);
  await expect(cards(page).filter({ hasText: "Safe Streets for Millbrook" }).first()).toBeVisible({ timeout: 30_000 });
  await expectCivicPanel(page);
});

test("check 8: an instance with modes_enabled = [civic] hides the switch and opens in Civic", async ({ page, baseURL }) => {
  const hostname = `civic-only-${randomUUID().slice(0, 8)}.localhost`;
  await withAdmin((db) =>
    db.query(
      `INSERT INTO river.instances (hostname, name, theme, modes_enabled, default_mode, seed_follows, default_circles)
       SELECT $1, 'Civic only (test)', 'civic', ARRAY['civic'], 'civic', seed_follows, default_circles
         FROM river.instances WHERE id = $2`,
      [hostname, SEED_INSTANCE],
    ),
  );
  try {
    const url = new URL(baseURL!);
    url.hostname = hostname;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url.href);
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Civic" })).toBeVisible();
    await expectTheme(page, "civic");
    await expectCivicPanel(page);
    await expect(modeSwitch(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Everything" })).toHaveCount(0);
    await expect(cards(page).getByRole("button", { name: "Sample", exact: true })).toHaveCount(0);
    expect(new URL(page.url()).search).toBe(""); // opened in Civic without asking

    // An old link to Everything opens the instance's only mode instead.
    url.search = "?mode=everything";
    await page.goto(url.href);
    await expectTheme(page, "civic");
    await expect(page.getByRole("heading", { level: 1, name: "Civic" })).toBeVisible();
    await expect(page).not.toHaveURL(/mode=/);
    await expectNoSeriousAxeIssues(page);

    // The phone header has no picker either.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(modeSwitch(page)).toHaveCount(0);
  } finally {
    await withAdmin((db) => db.query("DELETE FROM river.instances WHERE hostname = $1", [hostname]));
  }
});
