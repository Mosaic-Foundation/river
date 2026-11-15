import { expect, test } from "./fixtures";
import { linkFromPage, resetStandIn, seriousAxe, signUp } from "./fediverseHelpers";
import { resetLimits, riverAccount, setClock, withAdmin } from "./identityHelpers";

// Boost, favourite and follow as a linked fediverse account (fediverse-posting-1.md items 2 and 4;
// checks 4, 8, 9, 18), against the SYNTHETIC stand-in server the dev server talks to
// (TEST_STAND_IN_FEDIVERSE=1). The seed follows' fediverse cards come from the recorded fixtures;
// the member's stand-in server resolves any https post or actor.

test.beforeEach(async ({ request }) => {
  await resetLimits(request);
  await setClock(request, 0);
  await resetStandIn(request);
});

interface Toggles {
  reblogs: string[];
  favourites: string[];
  follows: Record<string, string>;
}

test.describe("Boost and Favourite", () => {
  test("toggle on a fediverse card by keyboard, with the first-use note; a refusal changes back; Your activity undoes it (checks 4, 8, 18)", async ({ page, request }) => {
    await signUp(page, "toggles-card");
    await expect(page.getByTestId("card-boost")).toHaveCount(0);
    await linkFromPage(page, request, "@ana@mastodon.stand-in.example", "ana");
    await page.goto("/");
    await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });

    // Only live fediverse cards have the toggles: the same cards as Reply.
    await expect(page.getByTestId("card-boost").first()).toBeVisible();
    const withBoost = await page.locator("[data-testid=feed-card]:has([data-testid=card-boost])").count();
    const withReply = await page.locator("[data-testid=feed-card]:has([data-testid=card-reply])").count();
    expect(withBoost).toBeGreaterThan(0);
    expect(withBoost).toBe(withReply);

    const card = page.locator("[data-testid=feed-card]:has([data-testid=card-boost])").first();
    const boost = card.getByRole("button", { name: "Boost as @ana@mastodon.stand-in.example" });
    await expect(boost).toHaveAttribute("aria-pressed", "false");
    await boost.focus();
    await page.keyboard.press("Enter");
    await expect(card.getByTestId("card-boost")).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByTestId("card-boost")).toHaveText(/^Boosted/);
    await expect(card.getByTestId("card-toggle-message")).toHaveText(
      "Boosts, favourites and follows from the River are made publicly as @ana@mastodon.stand-in.example.",
    );
    let held = (await (await request.get("/api/test/stand-in-fediverse/toggles")).json()) as Toggles;
    expect(held.reblogs).toHaveLength(1);
    expect(await seriousAxe(page)).toEqual([]);

    // The stand-in refuses: Favourite changes back and shows its words as text.
    await request.put("/api/test/stand-in-fediverse/rules", {
      data: [{ path: "/api/v1/statuses/", method: "POST", answer: 422, message: "<b>No</b> thanks" }],
    });
    await card.getByTestId("card-favourite").click();
    await expect(card.getByTestId("card-toggle-message")).toHaveText("mastodon.stand-in.example says: <b>No</b> thanks");
    await expect(card.getByTestId("card-favourite")).toHaveAttribute("aria-pressed", "false");
    await request.put("/api/test/stand-in-fediverse/rules", { data: [] });

    // After a reload the River remembers its boost.
    await page.reload();
    const again = page.locator("[data-testid=feed-card]:has([data-testid=card-boost][aria-pressed=true])");
    await expect(again).toHaveCount(1, { timeout: 30_000 });

    // Your activity: the boost, undone from there.
    await page.goto("/activity");
    const entry = page.getByTestId("activity-entry").filter({ hasText: "Boosted" });
    await expect(entry).toHaveCount(1);
    await entry.getByTestId("activity-undo").click();
    await expect(page.getByRole("status").filter({ hasText: "Boost undone on mastodon.stand-in.example" })).toBeVisible();
    await expect(page.getByTestId("activity-entry").filter({ hasText: "Undid a boost" })).toHaveCount(1);
    held = (await (await request.get("/api/test/stand-in-fediverse/toggles")).json()) as Toggles;
    expect(held.reblogs).toEqual([]);
  });
});

test.describe("Starting state from the server", () => {
  test("a boost the River has no record of shows once the member points at the card (item 4)", async ({ page, request }) => {
    await signUp(page, "toggles-state");
    await linkFromPage(page, request, "@ana@mastodon.stand-in.example", "ana");
    await page.goto("/");
    await expect(page.getByTestId("card-boost").first()).toBeVisible({ timeout: 30_000 });
    const card = page.locator("[data-testid=feed-card]:has([data-testid=card-boost])").first();
    await card.getByTestId("card-boost").click();
    await expect(card.getByTestId("card-boost")).toHaveAttribute("aria-pressed", "true");

    // Forget the River's record, as if the boost had been made on the server itself.
    const account = await riverAccount(page.context());
    await withAdmin((db) => db.query("DELETE FROM river.member_actions WHERE account_id = $1 AND verb = 'boost'", [account]));
    await page.reload();
    const boost = page.locator("[data-testid=feed-card]:has([data-testid=card-boost])").first().getByTestId("card-boost");
    await expect(boost).toHaveAttribute("aria-pressed", "false", { timeout: 30_000 });
    await boost.focus();
    await expect(boost).toHaveAttribute("aria-pressed", "true");
    await expect(boost).toHaveText(/^Boosted/);
  });
});

test.describe("Follow on the server", () => {
  test("a fediverse space's Following row follows and unfollows its account as the linked account (checks 9, 18)", async ({ page, request }) => {
    await signUp(page, "toggles-follow");
    await linkFromPage(page, request, "@ana@mastodon.stand-in.example", "ana");
    await page.goto("/following");
    await expect(page.getByTestId("space-row").first()).toBeVisible({ timeout: 30_000 });
    const before = await page.getByTestId("space-row").count();

    const row = page.locator("[data-testid=space-row]:has([data-testid=server-follow-toggle])").first();
    const disclosure = row.getByTestId("server-follow-toggle");
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    const button = row.getByTestId("server-follow-button");
    await expect(button).toHaveText("Follow");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveText("Unfollow");
    await expect(row.getByRole("status")).toContainText("Following as @ana@mastodon.stand-in.example");
    let held = (await (await request.get("/api/test/stand-in-fediverse/toggles")).json()) as Toggles;
    expect(Object.values(held.follows)).toEqual(["following"]);
    expect(await seriousAxe(page)).toEqual([]);

    // Following on the server didn't change what the River follows.
    expect(await page.getByTestId("space-row").count()).toBe(before);

    await button.click();
    await expect(button).toHaveText("Follow");
    held = (await (await request.get("/api/test/stand-in-fediverse/toggles")).json()) as Toggles;
    expect(held.follows).toEqual({});
  });
});
