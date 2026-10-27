import { expect, test } from "./fixtures";
import { linkFromPage, resetStandIn, seriousAxe, signUp } from "./fediverseHelpers";
import { resetLimits, setClock } from "./identityHelpers";

// Posting and replying as a linked fediverse account (fediverse-posting-1.md items 2 and 3;
// checks 4, 5, 6, 7, 11, 18), against the SYNTHETIC stand-in server the dev server talks to
// (TEST_STAND_IN_FEDIVERSE=1). The seed follows' fediverse cards come from the recorded fixtures;
// the reply goes to the member's stand-in server, which resolves any https post.

test.beforeEach(async ({ request }) => {
  await resetLimits(request);
  await setClock(request, 0);
  await resetStandIn(request);
});

test.describe("The composer", () => {
  test("Reply on a fediverse card: write, preview the exact request, send by keyboard; Your activity lists it (checks 4, 5, 7, 18)", async ({ page, request }) => {
    await signUp(page, "composer-reply");
    // Before linking: no Post and no Reply.
    await expect(page.getByTestId("post-button")).toHaveCount(0);
    await expect(page.getByTestId("card-reply")).toHaveCount(0);

    await linkFromPage(page, request, "@ana@mastodon.stand-in.example", "ana");
    await page.goto("/");
    await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("post-button")).toBeVisible();

    // Reply shows on live fediverse cards only.
    const cards = page.getByTestId("feed-card");
    const total = await cards.count();
    const withReply = await page.locator("[data-testid=feed-card]:has([data-testid=card-reply])").count();
    expect(withReply).toBeGreaterThan(0);
    expect(withReply).toBeLessThan(total);

    const card = page.locator("[data-testid=feed-card]:has([data-testid=card-reply])").first();
    await card.getByTestId("card-reply").click();
    const composer = page.getByTestId("composer");
    await expect(composer.getByRole("heading", { name: "Reply" })).toBeVisible();
    await expect(composer.getByTestId("composer-quote")).toContainText("Replying to");

    // Visibility: the three, never Direct, defaulting to the account's own (Quiet public).
    const visibility = composer.getByLabel("Visibility");
    await expect(visibility).toHaveValue("unlisted");
    await expect(visibility.locator("option")).toHaveText(["Public", "Quiet public", "Followers only"]);

    const box = composer.getByLabel("Your reply");
    await expect(box).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type("Thanks for this.");
    expect(await seriousAxe(page)).toEqual([]);
    // Preview by keyboard: Tab to it and press Enter.
    const previewButton = composer.getByRole("button", { name: "Preview" });
    await previewButton.focus();
    await page.keyboard.press("Enter");

    const preview = composer.getByTestId("composer-preview");
    await expect(preview).toContainText("from @ana@mastodon.stand-in.example on mastodon.stand-in.example · Quiet public");
    await expect(preview).toContainText("In reply to:");
    // Send has focus when the preview opens.
    await expect(composer.getByRole("button", { name: "Send" })).toBeFocused();
    await preview.getByText("Show exactly what will be sent").click();
    const exact = preview.getByTestId("composer-request");
    await expect(exact).toContainText("POST https://mastodon.stand-in.example/api/v1/statuses");
    await expect(exact).toContainText('"in_reply_to_id"');
    await expect(exact).toContainText("Thanks for this.");
    expect(await seriousAxe(page)).toEqual([]);

    await composer.getByRole("button", { name: "Send" }).focus();
    await page.keyboard.press("Enter");
    const done = composer.getByTestId("composer-done");
    await expect(done).toContainText("Posted on mastodon.stand-in.example");
    await expect(done.getByRole("link", { name: "View ↗" })).toHaveAttribute("href", /^https:\/\/mastodon\.stand-in\.example\/@ana\/\d+$/);
    const statuses = (await (await request.get("/api/test/stand-in-fediverse/statuses")).json()) as Array<{ content: string; idempotencyKey: string; inReplyToId: string }>;
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.inReplyToId).toBeTruthy();
    expect(statuses[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

    await composer.getByRole("button", { name: "Done" }).click();
    await expect(composer).toHaveCount(0);
    await expect(card.getByTestId("card-reply")).toBeFocused();

    await page.goto("/activity");
    const entry = page.getByTestId("activity-entry").first();
    await expect(entry).toContainText("Replied as @ana@mastodon.stand-in.example");
    await expect(entry.getByRole("link", { name: "View ↗" })).toBeVisible();
  });

  test("Post: the counter follows the server's limit and Preview is disabled over it (check 6)", async ({ page, request }) => {
    await signUp(page, "composer-limit");
    await linkFromPage(page, request, "@ana@mastodon.stand-in.example", "ana");
    await page.goto("/");
    await page.getByTestId("post-button").click();
    const composer = page.getByTestId("composer");
    await expect(composer.getByRole("heading", { name: "New post" })).toBeVisible();
    const box = composer.getByLabel("Your post");
    const url = "https://example.com/abcdefghijklmnopqrst";
    await box.fill(`See ${url}`);
    await expect(composer.getByTestId("composer-counter")).toHaveText("27 / 500");
    await composer.getByRole("button", { name: "Add a content warning" }).click();
    await composer.getByLabel("Content warning").fill("CW");
    await expect(composer.getByTestId("composer-counter")).toHaveText("29 / 500");
    await box.fill("a".repeat(501));
    await expect(composer.getByTestId("composer-counter")).toHaveText("503 / 500 (too long)");
    await expect(composer.getByRole("button", { name: "Preview" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(composer).toHaveCount(0);
  });

  test("a server's refusal shows its words as text and keeps the post (check 11)", async ({ page, request }) => {
    await signUp(page, "composer-422");
    await linkFromPage(page, request, "@ana@mastodon.stand-in.example", "ana");
    await page.goto("/");
    await page.getByTestId("post-button").click();
    const composer = page.getByTestId("composer");
    await composer.getByLabel("Your post").fill("Hello there");
    await composer.getByRole("button", { name: "Preview" }).click();
    await request.put("/api/test/stand-in-fediverse/rules", { data: [{ path: "/api/v1/statuses", answer: 422, message: "<b>No</b> thanks" }] });
    await composer.getByRole("button", { name: "Send" }).click();
    const error = composer.getByTestId("composer-error");
    await expect(error).toHaveText("mastodon.stand-in.example says: <b>No</b> thanks");
    await expect(error.locator("b")).toHaveCount(0);
    await expect(composer.getByLabel("Your post")).toHaveValue("Hello there");
  });

  test("a visitor sees no Post and no Reply", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("post-button")).toHaveCount(0);
    await expect(page.getByTestId("card-reply")).toHaveCount(0);
  });
});

test.describe("Delete from Your activity", () => {
  test("deletes a post made from the River, with the copies note, by keyboard (checks 10 and 18)", async ({ page, request }) => {
    await signUp(page, "composer-delete");
    await linkFromPage(page, request, "@ana@mastodon.stand-in.example", "ana");
    await page.goto("/");
    await page.getByTestId("post-button").click();
    const composer = page.getByTestId("composer");
    await composer.getByLabel("Your post").fill("A post I will delete");
    await composer.getByRole("button", { name: "Preview" }).click();
    await composer.getByRole("button", { name: "Send" }).click();
    await expect(composer.getByTestId("composer-done")).toContainText("Posted on mastodon.stand-in.example");

    await page.goto("/activity");
    const entry = page.getByTestId("activity-entry").first();
    await expect(entry).toContainText("Posted as @ana@mastodon.stand-in.example");
    const remove = entry.getByRole("button", { name: "Delete this post" });
    await remove.focus();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("group", { name: "Delete this post on mastodon.stand-in.example?" });
    await expect(confirm).toContainText("Other servers are asked to delete their copies; some may keep them.");
    expect(await seriousAxe(page)).toEqual([]);
    await confirm.getByRole("button", { name: "Delete" }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("activity-notice")).toHaveText(
      "Deleted on mastodon.stand-in.example. Other servers are asked to delete their copies; some may keep them.",
    );
    const entries = page.getByTestId("activity-entry");
    await expect(entries.nth(0)).toContainText("Deleted a post as @ana@mastodon.stand-in.example");
    await expect(entries.nth(1)).toContainText("Undone");
    await expect(page.getByRole("button", { name: /^Delete this/ })).toHaveCount(0);
    expect((await (await request.get("/api/test/stand-in-fediverse/statuses")).json()) as unknown[]).toHaveLength(0);
  });
});
