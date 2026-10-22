import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { identityURL } from "../../playwright.config";
import { expect, test } from "./fixtures";
import {
  CLIENT,
  SESSION_COOKIE,
  addAuthenticator,
  callbackParams,
  resetLimits,
  riverAccount,
  setClock,
  signIn,
  testEmail,
  throughCallback,
  withAdmin,
} from "./identityHelpers";

// M8, the River's sign-in (spec 4.6, F2, F3, F4, F10; checks 10 and 23). Every flow is real: the
// River's Sign up button, the identity host's passkey page with Chromium's virtual authenticator,
// the signed note, the River's callback and its session cookie.

const SEED_INSTANCE = "00000000-0000-4000-8000-000000000001";
const DAY_S = 24 * 60 * 60;

test.beforeEach(async ({ request }) => {
  await resetLimits(request);
  await setClock(request, 0);
});

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

async function openFeed(page: Page): Promise<void> {
  await page.goto("/");
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
}

/** The River's own feed call, from the page (so the session cookie goes with it). */
async function feed(page: Page): Promise<{ viewer: { did: string | null } | null; circles: Array<{ id: string; name: string; role: string | null }>; items: Array<{ id: string; read?: boolean }> }> {
  return page.evaluate(async () => (await fetch("/api/feed")).json());
}

/** Signs up from the River's Follow dialog (desktop); returns the DID once back on the River. */
async function signUpFromRiver(page: Page, label: string): Promise<string> {
  await addAuthenticator(page);
  await openFeed(page);
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await page.getByRole("dialog", { name: "Follow a Space" }).getByRole("link", { name: "Sign up" }).click();
  await page.waitForURL(`${identityURL}/authorize?**`);
  await page.getByLabel("Email address").fill(testEmail(label));
  await page.getByRole("button", { name: "Create a passkey" }).click();
  const url = await throughCallback(page, () => page.getByRole("link", { name: "Continue to Mosaic River" }).click());
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  return callbackParams(url).note.payload.sub;
}

test("check 10: sign-up makes an account with a did login method, the seeds copied, and a session cookie", async ({ page, context }) => {
  const did = await signUpFromRiver(page, "check10");

  // The River shows who is signed in, by DID (the note carries no name).
  await expect(page.locator(".account-name")).toHaveText(did);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);

  // The session cookie: HttpOnly, Secure, SameSite=Lax, 30 days; the state cookie is gone.
  const cookies = await context.cookies(CLIENT);
  const session = cookies.find((c) => c.name === SESSION_COOKIE);
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  expect(session!.expires - Date.now() / 1000).toBeGreaterThan(30 * DAY_S - 120);
  expect(session!.expires - Date.now() / 1000).toBeLessThanOrEqual(30 * DAY_S + 5);
  expect(cookies.find((c) => c.name === "__Host-river-signin")).toBeUndefined();
  expect(await page.evaluate(() => document.cookie)).toBe("");

  // The account: one did login method whose SCID is the DID's.
  const account = await riverAccount(context);
  const scid = did.split(":")[2];
  const db = await withAdmin(async (client) => {
    const logins = (await client.query("SELECT kind, did, scid, instance_id FROM river.login_methods WHERE account_id = $1", [account])).rows;
    const person = (await client.query("SELECT scid FROM identity.people WHERE did = $1", [did])).rows[0];
    const instance = (await client.query("SELECT seed_follows, default_circles FROM river.instances WHERE id = $1", [SEED_INSTANCE])).rows[0];
    const follows = (
      await client.query(
        "SELECT s.canonical_url, f.rule, f.stream_id FROM river.follows f JOIN river.spaces s ON s.id = f.space_id WHERE f.account_id = $1",
        [account],
      )
    ).rows;
    const circles = (
      await client.query(
        `SELECT c.name, c.color, c.role, count(cm.space_id)::int AS members
           FROM river.circles c LEFT JOIN river.circle_members cm ON cm.circle_id = c.id
          WHERE c.account_id = $1 GROUP BY c.id ORDER BY c.sort`,
        [account],
      )
    ).rows;
    const pending = (await client.query("SELECT count(*)::int AS n FROM river.preferences WHERE account_id = $1", [account])).rows[0].n;
    return { logins, person, instance, follows, circles, pending };
  });
  expect(db.logins).toEqual([{ kind: "did", did, scid, instance_id: SEED_INSTANCE }]);
  expect(db.person.scid).toBe(scid);

  // Seed follows and default circles copied, the civic-role circle included.
  const seeds = db.instance.seed_follows as Array<{ url: string }>;
  const defaults = db.instance.default_circles as Array<{ name: string; color: string; role?: string; members: string[] }>;
  expect(db.follows).toHaveLength(seeds.length);
  expect(db.follows.every((f: { rule: string; stream_id: string | null }) => f.rule === "follow" && f.stream_id === null)).toBe(true);
  expect(db.follows.map((f: { canonical_url: string }) => f.canonical_url)).toEqual(
    expect.arrayContaining(["https://demosville.civic.social", "https://w3c.social/users/w3c", "urn:mosaic:sample:okafor-family"]),
  );
  expect(db.circles).toEqual(
    defaults.map((c) => ({ name: c.name, color: c.color, role: c.role ?? null, members: c.members.length })),
  );
  expect(db.circles.filter((c: { role: string | null }) => c.role === "civic").map((c: { name: string }) => c.name)).toEqual(["Civic"]);
  expect(db.pending).toBe(0);

  // The member's feed: their circles (by id) and the seeds' items.
  const body = await feed(page);
  expect(body.viewer?.did).toBe(did);
  expect(body.circles.map((c) => c.name)).toEqual(defaults.map((c) => c.name));
  expect(body.circles.every((c) => /^[0-9a-f-]{36}$/.test(c.id))).toBe(true);
  expect(body.items.length).toBeGreaterThan(5);

  // Filtering by the member's circle works from the sidebar.
  const sidebar = page.getByRole("complementary", { name: "Filters" });
  await sidebar.getByRole("button", { name: "Soccer" }).click();
  await expect(cards(page).first()).toContainText("Riverside Rovers");
  await expect(page).toHaveURL(/circle=[0-9a-f-]{36}/);

  // Signing in again finds the same account (spec F3) and copies nothing twice.
  await context.clearCookies();
  await signIn(page);
  expect(await riverAccount(context)).toBe(account);
  const again = await withAdmin(async (client) => ({
    follows: (await client.query("SELECT count(*)::int AS n FROM river.follows WHERE account_id = $1", [account])).rows[0].n,
    circles: (await client.query("SELECT count(*)::int AS n FROM river.circles WHERE account_id = $1", [account])).rows[0].n,
    accounts: (await client.query("SELECT count(*)::int AS n FROM river.login_methods WHERE scid = $1", [scid])).rows[0].n,
  }));
  expect(again).toEqual({ follows: seeds.length, circles: defaults.length, accounts: 1 });
});

test("check 23: a member's Mark read, Mark unread, opened links and Mark all read persist across reload", async ({ page, context }) => {
  await signUpFromRiver(page, "check23");
  const account = await riverAccount(context);
  const reads = async () =>
    withAdmin(async (client) =>
      (await client.query("SELECT item_id FROM river.read_state WHERE account_id = $1", [account])).rows.map((r) => r.item_id as string),
    );
  expect(await reads()).toEqual([]);

  const first = cards(page).first();
  const firstId = (await first.getAttribute("data-item-id")) ?? "";
  await first.getByRole("button", { name: "Mark read" }).click();
  await expect(first.getByRole("button", { name: "Mark unread" })).toBeVisible();
  await expect.poll(reads).toEqual([firstId]);

  // Opening a live item marks it read too (ui-revisions-1 item 1), here with Open ↗
  // (ui-revisions-3 item 1).
  const live = cards(page).and(page.locator('[data-source="live"]')).nth(1);
  const liveId = (await live.getAttribute("data-item-id")) ?? "";
  const popup = page.context().waitForEvent("page");
  await live.getByTestId("card-open").click();
  await (await popup).close();
  await expect(page.locator(`[data-item-id="${liveId}"]`).getByTestId("unread-dot")).toHaveCount(0);
  await expect.poll(async () => (await reads()).sort()).toEqual([firstId, liveId].sort());

  // A reload (a new page view) still shows both read: the state is on the server.
  await page.reload();
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`[data-item-id="${firstId}"]`).getByRole("button", { name: "Mark unread" })).toBeVisible();
  await expect(page.locator(`[data-item-id="${liveId}"]`).getByTestId("unread-dot")).toHaveCount(0);
  // Nothing went to this browser's storage.
  expect(await page.evaluate(() => localStorage.getItem("mosaic-river:read"))).toBeNull();

  // Mark unread, and it stays unread after a reload.
  await page.locator(`[data-item-id="${firstId}"]`).getByRole("button", { name: "Mark unread" }).click();
  await expect.poll(reads).toEqual([liveId]);
  await page.reload();
  await expect(page.locator(`[data-item-id="${firstId}"]`).getByRole("button", { name: "Mark read" })).toBeVisible({ timeout: 30_000 });

  // Mark all read covers the view, including items not loaded yet.
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByTestId("unread-dot")).toHaveCount(0);
  await page.reload();
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("unread-dot")).toHaveCount(0);
  await expect(page.getByText(/^0 unread/)).toBeVisible();
  const total = await withAdmin(async (client) =>
    (await client.query("SELECT count(*)::int AS n FROM river.read_state WHERE account_id = $1", [account])).rows[0].n,
  );
  expect(total).toBeGreaterThan(await cards(page).count());
});

test("sign out (F10) clears the River session; the page is a visitor's again", async ({ page, context }) => {
  await signUpFromRiver(page, "signout");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator(".topbar").getByRole("link", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sample-banner")).toBeVisible();
  expect((await context.cookies(CLIENT)).find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  expect((await feed(page)).viewer).toBeNull();
});

test("phone: the You tab offers Sign up and Sign in, then shows the member and Sign out", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await addAuthenticator(page);
  await openFeed(page);
  const tabs = page.getByRole("navigation", { name: "River sections" });
  await tabs.getByRole("button", { name: "You" }).click();
  await expect(page.locator(".tab-placeholder").getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.getByRole("link", { name: "Sign up" }).click();
  await page.waitForURL(`${identityURL}/authorize?**`);
  await page.getByLabel("Email address").fill(testEmail("phone"));
  await page.getByRole("button", { name: "Create a passkey" }).click();
  const url = await throughCallback(page, () => page.getByRole("link", { name: "Continue to Mosaic River" }).click());
  const did = callbackParams(url).note.payload.sub;
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  await tabs.getByRole("button", { name: "You" }).click();
  await expect(page.locator(".account-id")).toHaveText(did);
  await expect(page.locator(".account-name")).toBeHidden();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id)).toEqual([]);
  await page.getByRole("button", { name: "Sign out" }).click();
  await tabs.getByRole("button", { name: "You" }).click();
  await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible({ timeout: 30_000 });
});

test("a callback that isn't this browser's sign-in gets 401, the River's refusal page and no session", async ({ page, context }) => {
  const res = await page.goto("/api/auth/callback?state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&note=a.b.c");
  expect(res?.status()).toBe(401);
  expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByRole("heading", { name: "Sign-in didn't work" })).toBeVisible();
  expect((await context.cookies(CLIENT)).find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  await page.getByRole("link", { name: "Go to the River" }).click();
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
});
