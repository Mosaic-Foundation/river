import { expect, test } from "./fixtures";

// The River UI loads at / and shows the feed from the API (M6 replaced M0's status page).
test("the app loads and shows the feed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Everything" })).toBeVisible();
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
});
