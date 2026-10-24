import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { identityURL } from "../../playwright.config";
import { expect, test } from "./fixtures";
import { addAuthenticator, resetLimits, setClock, testEmail, throughCallback } from "./identityHelpers";

// Bluesky (docs/spec/bluesky-1.md items 2, 3 and 5; ADR-009). A real member follows @bsky.app by
// its handle from the follow box (preview: name, avatar, bio), then filters the River by the
// Bluesky network: only Bluesky cards remain, they stay in the feed with "Open ↗" to bsky.app,
// say "reposted", and show link cards and quoted posts. The AppView and PLC responses are real
// recordings the API replays (FETCH_FIXTURES_DIR); nothing leaves loopback.

test.beforeEach(async ({ request }) => {
  await resetLimits(request);
  await setClock(request, 0);
});

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

async function signUp(page: Page, label: string): Promise<void> {
  await addAuthenticator(page);
  await page.goto("/");
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/api/auth/signin");
  await page.waitForURL(`${identityURL}/authorize?**`);
  await page.getByLabel("Email address").fill(testEmail(label));
  await page.getByRole("button", { name: "Create a passkey" }).click();
  await throughCallback(page, () => page.getByRole("link", { name: "Continue to Mosaic River" }).click());
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
}

async function adapters(page: Page): Promise<Set<string>> {
  await expect(cards(page).first()).toBeVisible();
  return new Set(await cards(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-adapter") ?? "")));
}

test("follow @bsky.app by handle, then filter the River by Bluesky", async ({ page, blocked }) => {
  await signUp(page, "bluesky");
  await page.goto("/following");
  await expect(page.getByRole("heading", { level: 1, name: "Following" })).toBeVisible();

  // The follow box previews name, avatar and bio.
  const box = page.getByRole("region", { name: "Follow something" });
  await box.getByLabel("Web address or handle").fill("@bsky.app");
  await box.getByRole("button", { name: "Look it up" }).click();
  const preview = box.getByTestId("follow-preview");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview.locator(".follow-preview-name")).toHaveText("Bluesky");
  await expect(preview).toContainText("Bluesky account · @bsky.app");
  // The avatar loads straight from Bluesky's CDN (the test cuts it off and records the attempt).
  await expect.poll(() => blocked.some((b) => b.resourceType === "image" && b.url.startsWith("https://cdn.bsky.app/img/avatar/"))).toBe(true);
  await expect(preview.getByTestId("follow-preview-bio")).not.toBeEmpty();
  await box.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(box.getByRole("status")).toContainText("You're following", { timeout: 30_000 });

  // On the Following page, under "Bluesky", by its handle.
  const row = page.getByTestId("space-row").filter({ has: page.locator(".space-row-name", { hasText: "Bluesky" }) });
  await expect(row).toContainText("@bsky.app");

  // The River's Networks filter has Bluesky; it keeps only Bluesky cards.
  await page.getByRole("link", { name: "Back to your River" }).click();
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  const networks = page.getByRole("complementary", { name: "Filters" }).getByRole("navigation", { name: "Networks" });
  await networks.getByRole("button", { name: "Bluesky" }).click();
  await expect(networks.getByRole("button", { name: "Bluesky" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/network=bluesky/);
  await expect.poll(() => adapters(page)).toEqual(new Set(["atproto"]));

  // Bluesky posts stay in the feed: no framing check, a click on the body opens nothing, and
  // "Open ↗" goes to the post on bsky.app in a new tab.
  const first = cards(page).first();
  await expect(first).toHaveAttribute("data-open", "none");
  const open = first.getByTestId("card-open");
  await expect(open).toHaveAttribute("href", /^https:\/\/bsky\.app\/profile\/did:plc:[a-z2-7]{24}\/post\//);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", /noopener/);
  await expect(first.getByTestId("card-host")).toHaveText("bsky.app");
  const url = page.url();
  await first.locator(".card-kind").click();
  expect(page.url()).toBe(url);

  // A repost reads "Bluesky reposted" above the original author; a quote shows the quoted post.
  await expect(page.getByTestId("boost-line").filter({ hasText: "Bluesky reposted" }).first()).toBeVisible();
  const quote = page.getByTestId("card-quote").first();
  await quote.scrollIntoViewIfNeeded();
  await expect(quote).toBeVisible();
  const link = page.getByTestId("card-link").first();
  await link.scrollIntoViewIfNeeded();
  await expect(link).toHaveAttribute("href", /^https:\/\//);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);

  // Every card in view is from @bsky.app's space, and none links into the River's embedded view.
  expect(await page.locator(`[data-testid="feed-card"]:not([data-adapter="atproto"])`).count()).toBe(0);
  expect(await page.locator('[data-testid="feed-card"] a[href^="/item/"]').count()).toBe(0);

  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id);
  expect(serious).toEqual([]);
});

test("Import from Bluesky: list who @eff.org follows, choose a circle, follow them all", async ({ page }) => {
  await signUp(page, "bluesky-import");
  await page.goto("/following");
  await expect(page.getByRole("heading", { level: 1, name: "Following" })).toBeVisible();

  const box = page.getByRole("region", { name: "Import from Bluesky" });
  await box.getByLabel("Bluesky handle").fill("@eff.org");
  await box.getByRole("button", { name: "List follows" }).click();
  const preview = box.getByTestId("import-preview");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByTestId("import-count")).toContainText(/^@eff\.org follows \d+ accounts\./);
  await expect(preview.getByRole("list", { name: "Some of the accounts" }).getByRole("listitem")).toHaveCount(12);
  const count = Number(/follows (\d+) accounts/.exec((await preview.getByTestId("import-count").textContent()) ?? "")?.[1]);
  expect(count).toBeGreaterThan(200);

  // One circle, chosen as a radio; "No circle" is the default.
  const circles = preview.getByRole("group", { name: "Add them to a circle" });
  await expect(circles.getByRole("radio", { name: "No circle" })).toBeChecked();
  await circles.getByRole("radio", { name: "News and ideas" }).check();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id)).toEqual([]);

  await preview.getByRole("button", { name: `Follow all ${count}` }).click();
  await expect(box.getByRole("status")).toContainText(`You're now following ${count} more accounts, in News and ideas.`, {
    timeout: 30_000,
  });

  // They are under "Bluesky" on the Following page.
  await expect(page.locator(".group-title", { hasText: /^Bluesky$/ })).toBeVisible({ timeout: 30_000 });
});
