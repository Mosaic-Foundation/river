import { expect, test } from "./fixtures";
import { approveAs, resetStandIn, seriousAxe, signUp } from "./fediverseHelpers";
import { resetLimits, setClock } from "./identityHelpers";

// Settings → Linked accounts (fediverse-posting-1.md item 1; checks 1, 2 and 18): linking and
// unlinking a fediverse account from the page, against the SYNTHETIC stand-in server the dev
// server talks to (TEST_STAND_IN_FEDIVERSE=1). The browser's visit to the server's authorize page
// is answered here: the stand-in's test route approves (as the account named) and the page is sent
// on to the River's callback, as the real server would.

test.beforeEach(async ({ request }) => {
  await resetLimits(request);
  await setClock(request, 0);
  await resetStandIn(request);
});

test.describe("Linked accounts", () => {
  test("link and unlink a Mastodon account from the keyboard alone; axe on each step (checks 1 and 18)", async ({ page, request }) => {
    await signUp(page, "linked-keyboard");
    const visited = await approveAs(page, request, "ana");

    // Settings, in the profile menu, links here.
    await page.locator(".topbar").getByRole("button", { name: "Your profile and settings" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    const settings = page.getByTestId("settings");
    await expect(settings.getByRole("link", { name: "Linked accounts" })).toHaveAttribute("href", "/linked-accounts");
    await settings.getByRole("link", { name: "Linked accounts" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Linked accounts" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("linked-empty")).toBeVisible();
    expect(await seriousAxe(page)).toEqual([]);

    const box = page.getByLabel("Your handle or profile address");
    await box.focus();
    await page.keyboard.type("@ana@mastodon.stand-in.example");
    await page.keyboard.press("Enter");

    const explainer = page.getByTestId("link-explainer");
    await expect(explainer).toContainText(
      "Mosaic River will be able to post and reply as @ana@mastodon.stand-in.example, boost, favourite, follow and unfollow, and delete posts you make from the River.",
    );
    await expect(explainer).toContainText("It can't read your messages or change your profile.");
    const go = page.getByRole("button", { name: "Continue to mastodon.stand-in.example" });
    await expect(go).toBeFocused();
    expect(await seriousAxe(page)).toEqual([]);
    await page.keyboard.press("Enter");

    await page.waitForURL(/\/linked-accounts$/, { timeout: 30_000 });
    await expect(page.getByTestId("link-notice")).toHaveText("Your account is linked.");
    const row = page.getByTestId("linked-account");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Ana (stand-in)");
    await expect(row).toContainText("@ana@mastodon.stand-in.example");
    await expect(row).toContainText("Mastodon");
    await expect(row).toContainText("The River can post and reply, boost, favourite, follow and unfollow");
    expect(await seriousAxe(page)).toEqual([]);

    // The browser went to the server's own authorize page, with PKCE S256 and the scopes.
    expect(visited).toHaveLength(1);
    const authorize = new URL(visited[0] ?? "");
    expect(authorize.pathname).toBe("/oauth/authorize");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("scope")).toBe("profile write:statuses write:favourites write:follows read:follows read:search");

    // Unlink, by keyboard: Tab to the button, Enter, then Enter on the confirmation.
    const unlink = page.getByRole("button", { name: "Unlink @ana@mastodon.stand-in.example" });
    for (let i = 0; i < 40 && !(await unlink.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(unlink).toBeFocused();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("group", { name: "Unlink @ana@mastodon.stand-in.example?" });
    await expect(confirm).toContainText("The River will ask mastodon.stand-in.example to forget its key");
    expect(await seriousAxe(page)).toEqual([]);
    await confirm.getByRole("button", { name: "Unlink" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("link-notice")).toHaveText(
      "@ana@mastodon.stand-in.example is unlinked, and mastodon.stand-in.example has forgotten the River's key.",
    );
    await expect(page.getByTestId("linked-empty")).toBeVisible();
  });

  test("a GoToSocial link, and another account than the one named (checks 2 and 3)", async ({ page, request }) => {
    await signUp(page, "linked-other");
    await approveAs(page, request, "bob");
    await page.goto("/linked-accounts");
    await page.getByLabel("Your handle or profile address").fill("@ana@gts.stand-in.example");
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByTestId("link-explainer")).toContainText("gts.stand-in.example runs GoToSocial");
    await page.getByRole("button", { name: "Continue to gts.stand-in.example" }).click();
    await page.waitForURL(/\/linked-accounts$/, { timeout: 30_000 });
    await expect(page.getByTestId("link-notice")).toHaveText("That's a different account from the one you named. Nothing was linked.");
    await expect(page.getByTestId("linked-account")).toHaveCount(0);

    // The name the server gives shows as text, never as markup.
    await page.getByLabel("Your handle or profile address").fill("@bob@gts.stand-in.example");
    await page.getByRole("button", { name: "Check" }).click();
    await page.getByRole("button", { name: "Continue to gts.stand-in.example" }).click();
    await page.waitForURL(/\/linked-accounts$/, { timeout: 30_000 });
    await expect(page.getByTestId("linked-account")).toContainText("Bob <b>stand-in</b>");
    await expect(page.getByTestId("linked-account").locator("b")).toHaveCount(0);
  });

  test("an unsupported server is refused before anything is registered (check 3)", async ({ page, request }) => {
    await signUp(page, "linked-akkoma");
    await page.goto("/linked-accounts");
    await page.getByLabel("Your handle or profile address").fill("@ana@akkoma.stand-in.example");
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByRole("alert")).toHaveText("The River can't post through Akkoma yet.");
    await expect(page.getByTestId("link-explainer")).toHaveCount(0);
    const requests = (await (await request.get("/api/test/stand-in-fediverse/requests")).json()) as Array<{ method: string }>;
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
  });

  test("a visitor gets the sign-up prompt", async ({ page }) => {
    await page.goto("/linked-accounts");
    await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Your handle or profile address")).toHaveCount(0);
  });

  test("on a phone, the You tab links to Linked accounts", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signUp(page, "linked-phone");
    await page.getByRole("navigation", { name: "River sections" }).getByRole("button", { name: "You" }).click();
    await expect(page.getByRole("link", { name: "Linked accounts" }).first()).toHaveAttribute("href", "/linked-accounts");
  });
});
