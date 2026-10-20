import { expect, test, type Page } from "@playwright/test";

// M0: the Mosaic theme is the default, the Civic theme applies with data-theme="civic", and
// every font comes from the River's own origin (no requests to Google or any other host).
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
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
    if (!req.url().startsWith(origin) && !req.url().startsWith("data:")) offOrigin.push(req.url());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.locator("html").getAttribute("data-theme")).toBe("mosaic");
  expect(await token(page, "--color-primary")).toBe("#14335f");
  expect(await token(page, "--shadow-card")).toBe("0 6px 24px rgba(20, 51, 95, 0.08)");
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
