import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import pg from "pg";
import { identityURL } from "../../playwright.config";
import { expect, test } from "./fixtures";
import {
  ADMIN_URL,
  addAuthenticator,
  resetLimits,
  riverAccount,
  setClock,
  testEmail,
  throughCallback,
} from "./identityHelpers";

// Your activity (ADR-010 §7): the list of what the River sent in the member's name, read only in
// A1. Nothing in the River sends yet, so the acts are written straight to the database (as the
// local stack's postgres, setup only), the way src/river/acting/acts.ts writes them.

test.beforeEach(async ({ request }) => {
  await resetLimits(request);
  await setClock(request, 0);
});

async function signUp(page: Page, label: string): Promise<string> {
  await addAuthenticator(page);
  await page.goto("/");
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/api/auth/signin");
  await page.waitForURL(`${identityURL}/authorize?**`);
  await page.getByLabel("Email address").fill(testEmail(label));
  await page.getByRole("button", { name: "Create a passkey" }).click();
  await throughCallback(page, () => page.getByRole("link", { name: "Continue to Mosaic River" }).click());
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
  const account = await riverAccount(page.context());
  if (!account) throw new Error("no River session after sign-up");
  return account;
}

/** Writes acts for an account, oldest first, a minute apart. */
async function seedActs(accountId: string, rows: Array<Record<string, string | null>>): Promise<void> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    for (const [i, row] of rows.entries()) {
      const minutesAgo = rows.length - i;
      await client.query(
        `INSERT INTO river.member_actions (instance_id, account_id, channel, target_host, target_label, verb, limit_kind,
                                           status, subject_title, subject_url, remote_url, error_message, session_epoch,
                                           created_at, sent_at)
         SELECT a.instance_id, a.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1,
                now() - make_interval(mins => $12), now() - make_interval(mins => $12)
           FROM river.accounts a WHERE a.id = $1`,
        [
          accountId,
          row.channel ?? "fediverse",
          row.host ?? "example.social",
          row.label ?? "@ana@example.social",
          row.verb ?? "post",
          row.kind ?? "text",
          row.status ?? "sent",
          row.title ?? null,
          row.subjectUrl ?? null,
          row.remoteUrl ?? null,
          row.error ?? null,
          minutesAgo,
        ],
      );
    }
  } finally {
    await client.end();
  }
}

async function seriousAxe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

test.describe("Your activity", () => {
  test("from the profile menu: newest first, each result in words, links to what it made; keyboard and axe", async ({ page }) => {
    const account = await signUp(page, "activity-list");
    await seedActs(account, [
      { verb: "post", status: "sent", remoteUrl: "https://example.social/@ana/1" },
      { verb: "reply", status: "failed", error: "<b>Text is too long</b>", title: "A post by W3C", subjectUrl: "https://w3c.social/@w3c/9" },
      { channel: "space", verb: "comment", host: "demosville.civic.social", label: "Demosville", status: "held", title: "Bike lanes" },
      { verb: "boost", kind: "toggle", status: "unknown" },
    ]);

    await page.goto("/?mode=civic");
    await page.locator(".topbar").getByRole("button", { name: "Your profile and settings" }).click();
    const item = page.getByRole("menu", { name: "Your profile and settings" }).getByRole("menuitem", { name: "Your activity" });
    await expect(item).toHaveAttribute("href", "/activity?mode=civic");
    // ADR-010 §10: the menu reminds the member to check it after Sign out everywhere.
    await expect(page.getByTestId("profile-menu")).toContainText("After Sign out everywhere, check Your activity");
    await item.click();

    await expect(page.getByRole("heading", { level: 1, name: "Your activity" })).toBeVisible({ timeout: 30_000 });
    const entries = page.getByTestId("activity-entry");
    await expect(entries).toHaveCount(4);
    await expect(entries.nth(0)).toContainText("Boosted as @ana@example.social");
    await expect(entries.nth(0)).toContainText("We couldn't tell whether example.social got it");
    await expect(entries.nth(1)).toContainText("Commented at Demosville · Bike lanes");
    await expect(entries.nth(1)).toContainText("demosville.civic.social will show it after review");
    // The other side's words show as text, never as markup.
    await expect(entries.nth(2)).toContainText("example.social says: <b>Text is too long</b>");
    await expect(entries.nth(2).locator("b")).toHaveCount(0);
    await expect(entries.nth(2).getByRole("link", { name: "A post by W3C" })).toHaveAttribute("href", "https://w3c.social/@w3c/9");
    await expect(entries.nth(3)).toContainText("Posted as @ana@example.social");
    await expect(entries.nth(3).getByRole("link", { name: "View ↗" })).toHaveAttribute("href", "https://example.social/@ana/1");

    expect(await seriousAxe(page)).toEqual([]);
    // Keyboard: Tab reaches the entries' links.
    const reached: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      reached.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""));
    }
    expect(reached).toEqual(expect.arrayContaining(["A post by W3C", "View ↗"]));
  });

  test("a new member's list says nothing has been sent yet", async ({ page }) => {
    await signUp(page, "activity-empty");
    await page.goto("/activity");
    await expect(page.getByTestId("activity-empty")).toContainText("Nothing yet");
    expect(await seriousAxe(page)).toEqual([]);
  });

  test("a visitor gets the sign-up prompt", async ({ page }) => {
    await page.goto("/activity");
    await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("activity-entry")).toHaveCount(0);
  });

  test("on a phone, the You tab links to Your activity and says to check it after Sign out everywhere", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signUp(page, "activity-phone");
    await page.getByRole("navigation", { name: "River sections" }).getByRole("button", { name: "You" }).click();
    const links = page.getByRole("link", { name: "Your activity" });
    await expect(links.first()).toHaveAttribute("href", "/activity");
    await expect(page.getByText("for anything you didn't send")).toBeVisible();
  });
});
