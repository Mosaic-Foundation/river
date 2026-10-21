import type { Page } from "@playwright/test";
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
  expect(await token(page, "--color-primary")).toBe("#386759");
  expect(await token(page, "--color-bg")).toBe("#f0ebe1");
  expect(await loadedFamilies(page, ["16px Inter", '600 16px "Libre Franklin"'])).toEqual(
    expect.arrayContaining(["Inter", "Libre Franklin"]),
  );

  expect(fontRequests.length).toBeGreaterThan(0);
  expect(offOrigin).toEqual([]);
});
