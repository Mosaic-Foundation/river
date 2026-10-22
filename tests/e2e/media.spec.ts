import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { identityURL } from "../../playwright.config";
import { expect, test } from "./fixtures";
import { addAuthenticator, resetLimits, setClock, testEmail, throughCallback } from "./identityHelpers";

// M12 "Real media": a member follows a podcast feed and a PeerTube channel from the follow box,
// and their cards show the kind, the length and the source host; the reader view (ui-revisions-1
// item 1) has "Open in new tab" and plays the episode's audio and the video's file in place. Both sources are
// SYNTHETIC fixtures (tests/fixtures/http/synthetic-*, see TESTING.md) the API replays
// (FETCH_FIXTURES_DIR, TEST_CLOCK_NOW); the browser reaches nothing but loopback, so thumbnails
// from those hosts fail to load and the cards render without them (check 21's rule).

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

async function follow(page: Page, input: string, expected: { name: string; meta: string }): Promise<void> {
  const box = page.getByRole("region", { name: "Follow something" });
  await box.getByLabel("Web address or handle").fill(input);
  await box.getByRole("button", { name: "Look it up" }).click();
  const preview = box.getByTestId("follow-preview");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview.locator(".follow-preview-name")).toHaveText(expected.name);
  await expect(preview).toContainText(expected.meta);
  await box.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(box.getByRole("status")).toContainText("You're following", { timeout: 30_000 });
}

async function search(page: Page, words: string): Promise<void> {
  const box = page.getByRole("complementary", { name: "Filters" }).getByRole("searchbox");
  await box.fill(words);
  await box.press("Enter");
}

test("M12: a podcast feed and a PeerTube channel show their kind, length, host and Open in new tab", async ({ page }) => {
  await signUp(page, "m12media");
  await page.goto("/following");
  await expect(page.getByRole("heading", { level: 1, name: "Following" })).toBeVisible();

  // A podcast by its home page (the page names its feed), and a PeerTube channel by handle.
  await follow(page, "https://synthetic-podcast.example/", {
    name: "Synthetic Commons Radio",
    meta: "Podcast feed · synthetic-podcast.example",
  });
  await follow(page, "@trail_films@synthetic-tube.example", {
    name: "Synthetic Trail Films",
    meta: "PeerTube channel · @trail_films@synthetic-tube.example",
  });
  await expect(page.getByRole("heading", { name: "Feeds and podcasts" })).toBeVisible();

  await page.getByRole("link", { name: "Back to your River" }).click();
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });

  // The podcast episode: kind, length, its host; the reader opens it on its host (new tab,
  // noopener) and plays the audio in place, loading nothing until played.
  await search(page, "Libraries");
  const episode = cards(page).filter({ hasText: "Episode 3: Libraries after dark" });
  await expect(episode).toHaveCount(1);
  await expect(episode).toHaveAttribute("data-kind", "podcast");
  await expect(episode.locator(".card-kind")).toHaveText("Podcast");
  await expect(episode.getByRole("list", { name: "Details" })).toContainText("42 min");
  await expect(episode.locator(".card-source")).toHaveText("Synthetic Commons Radio");
  await expect(episode.locator(".label-live")).toBeVisible();
  await expect(episode.getByTestId("card-host")).toHaveText("synthetic-podcast.example");
  await episode.locator(".card-source").click();
  const reader = page.getByTestId("reader");
  const openEpisode = reader.getByRole("link", { name: /^Open in new tab/ });
  await expect(openEpisode).toHaveAttribute("href", "https://synthetic-podcast.example/episodes/3");
  await expect(openEpisode).toHaveAttribute("target", "_blank");
  await expect(openEpisode).toHaveAttribute("rel", /noopener/);
  const audio = reader.getByTestId("reader-player");
  await expect(audio).toHaveCount(1);
  expect(await audio.evaluate((el) => el.tagName)).toBe("AUDIO");
  await expect(audio).toHaveAttribute("src", /^https:\/\/synthetic-podcast\.example\//);
  await expect(audio).toHaveAttribute("preload", "none");
  await page.getByRole("button", { name: "Back to River" }).click();

  // The PeerTube video: kind, length as m:ss, its host; Open in new tab and a player in the reader.
  await search(page, "Ridge");
  const video = cards(page).filter({ hasText: "Ridge line at dawn" });
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("data-kind", "video");
  await expect(video.locator(".card-kind")).toHaveText("Video");
  await expect(video.getByRole("list", { name: "Details" })).toContainText("4:33");
  await expect(video.locator(".card-source")).toHaveText("Synthetic Trail Films");
  await expect(video).not.toContainText("boosted a post");
  await expect(video.getByTestId("card-host")).toHaveText("synthetic-tube.example");
  // Its thumbnail can't load here (no outside hosts): the card renders without a broken image.
  await expect(video.locator("img")).toHaveCount(0);
  await video.locator(".card-source").click();
  const openVideo = reader.getByRole("link", { name: /^Open in new tab/ });
  await expect(openVideo).toHaveAttribute("href", "https://synthetic-tube.example/w/cXqH7r2Lw9TzP4mV1nBk3s");
  await expect(openVideo).toHaveAttribute("rel", /noopener/);
  const player = reader.getByTestId("reader-player");
  await expect(player).toHaveCount(1);
  expect(await player.evaluate((el) => el.tagName)).toBe("VIDEO");
  await expect(player).toHaveAttribute("src", /^https:\/\/synthetic-tube\.example\//);
  await expect(player).toHaveAttribute("preload", "none");

  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id);
  expect(serious).toEqual([]);
});
