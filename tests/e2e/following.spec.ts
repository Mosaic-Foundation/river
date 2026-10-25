import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { identityURL } from "../../playwright.config";
import { expect, test } from "./fixtures";
import { addAuthenticator, resetLimits, riverAccount, setClock, testEmail, throughCallback, withAdmin } from "./identityHelpers";

// M9, Following (spec F6, F7, F8; checks 13, 14, 15, 17, 18, 19, and 31 for the Following page).
// Every member is real: signed up through the River's Sign up, the identity host's passkey page
// with Chromium's virtual authenticator, and the River's callback. Hubs and fediverse accounts are
// recorded responses the API replays (FETCH_FIXTURES_DIR, TEST_CLOCK_NOW); nothing leaves loopback.

const SEED_INSTANCE = "00000000-0000-4000-8000-000000000001";
const LONGMONT_MEETING = "https://longmont.civic.social/process/proc_4ebb11759c4c40ce";
const FLOYD_VOTE = "https://floyd.civic.social/process/proc_beta_vote_energy_001";

test.beforeEach(async ({ request }) => {
  await resetLimits(request);
  await setClock(request, 0);
});

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

/** Signs up from the River's header (desktop: Sign in → the identity host's page). */
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

interface ApiItem {
  id: string;
  streamKey: string | null;
  isFinalResult: boolean;
  boostOf: unknown;
  civic: { activityType?: string; objectType?: string } | null;
  space: { id: string; name: string };
}

/** Every page of the member's feed for a query, from the page (the session cookie goes along). */
async function feedItems(page: Page, query: Record<string, string> = {}): Promise<ApiItem[]> {
  return page.evaluate(async (q) => {
    const items: ApiItem[] = [];
    let cursor: string | null = null;
    for (let n = 0; n < 100; n++) {
      const params = new URLSearchParams(cursor ? { ...q, cursor } : q);
      const body = (await (await fetch(`/api/feed?${params}`)).json()) as { items: ApiItem[]; nextCursor: string | null };
      items.push(...body.items);
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    return items;
  }, query);
}

async function openFollowing(page: Page): Promise<void> {
  await page.goto("/following");
  await expect(page.getByRole("heading", { level: 1, name: "Following" })).toBeVisible();
  await expect(page.getByTestId("space-row").first()).toBeVisible({ timeout: 30_000 });
}

function spaceRow(page: Page, name: string | RegExp): Locator {
  return page.getByTestId("space-row").filter({ has: page.locator(".space-row-name", { hasText: name }) });
}

async function unfollow(page: Page, name: string): Promise<void> {
  await spaceRow(page, name).getByRole("button", { name: `Unfollow ${name}` }).click();
  await expect(spaceRow(page, name)).toHaveCount(0);
}

async function lookUp(page: Page, input: string): Promise<Locator> {
  const box = page.getByRole("region", { name: "Follow something" });
  await box.getByLabel("Web address or handle").fill(input);
  await box.getByRole("button", { name: "Look it up" }).click();
  const preview = box.getByTestId("follow-preview");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  return preview;
}

async function confirm(page: Page): Promise<void> {
  const box = page.getByRole("region", { name: "Follow something" });
  await box.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(box.getByRole("status")).toContainText("You're following", { timeout: 30_000 });
}

async function expectNoSeriousAxeIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(serious).toEqual([]);
}

test("check 13: following Demosville previews its name and initials, and its items show", async ({ page }) => {
  await signUp(page, "check13");
  await openFollowing(page);
  await expectNoSeriousAxeIssues(page);
  // The member starts with the seed follows; unfollow Demosville to follow it from the box.
  await unfollow(page, "Demosville Civic Hub");
  expect((await feedItems(page, { q: "Demosville" })).length).toBe(0);

  const preview = await lookUp(page, "https://demosville.civic.social");
  await expect(preview.locator(".follow-preview-name")).toHaveText("Demosville Civic Hub");
  await expect(preview.locator(".source-icon-initials")).toHaveText("DC");
  await expect(preview).toContainText("Civic Hub · demosville.civic.social");
  await expect(preview.getByRole("radio")).toHaveCount(0); // the whole hub: no stream choice
  await preview.getByRole("button", { name: "Civic" }).click();
  await expect(preview.getByRole("button", { name: "Civic" })).toHaveAttribute("aria-pressed", "true");
  await expectNoSeriousAxeIssues(page);
  await confirm(page);

  const row = spaceRow(page, "Demosville Civic Hub");
  await expect(row).toContainText("Whole space · demosville.civic.social");
  await expect(row.getByRole("button", { name: /^Circles for Demosville Civic Hub:/ })).toContainText("Civic");

  // Back on the River, its items show.
  await page.getByRole("link", { name: "Back to your River" }).click();
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("complementary", { name: "Filters" }).getByRole("searchbox").fill("Demosville");
  await page.getByRole("complementary", { name: "Filters" }).getByRole("searchbox").press("Enter");
  await expect(cards(page).first()).toContainText("Demosville Civic Hub");
  expect((await feedItems(page, { q: "Demosville" })).length).toBeGreaterThan(0);
});

test("checks 14 and 17: just one Longmont stream; a muted Floyd stream stays hidden", async ({ page }) => {
  await signUp(page, "check14");
  await openFollowing(page);
  await unfollow(page, "Longmont Civic Hub");

  const preview = await lookUp(page, "https://longmont.civic.social/meeting-summary/proc_4ebb11759c4c40ce");
  await expect(preview).toContainText("this link is one stream");
  await expect(preview.getByRole("radio", { name: "Just this stream (ends on its own when the process ends)" })).toBeChecked();
  await expect(preview.getByRole("radio", { name: "The whole space" })).not.toBeChecked();
  await confirm(page);

  // Under Spaces: Longmont, streams only, with that stream Following "until the process ends".
  const longmont = spaceRow(page, "Longmont Civic Hub");
  await expect(longmont).toContainText("Streams only · longmont.civic.social");
  await longmont.getByRole("button", { name: /Streams/ }).click();
  const stream = longmont.locator(`[data-stream-key="${LONGMONT_MEETING}"]`);
  await expect(stream).toContainText("Following");
  await expect(stream).toContainText("until the process ends");

  // The feed shows only that process's items from Longmont (check 14, and 17's second half).
  const fromLongmont = (await feedItems(page)).filter((i) => i.space.name === "Longmont Civic Hub");
  expect(fromLongmont.length).toBeGreaterThan(0);
  expect(new Set(fromLongmont.map((i) => i.streamKey))).toEqual(new Set([LONGMONT_MEETING]));

  // Check 17's first half: mute a stream inside Floyd (followed as a whole); its items go.
  const floyd = spaceRow(page, "Floyd Civic Hub");
  await floyd.getByRole("button", { name: /Streams/ }).click();
  const first = floyd.getByTestId("stream-row").first();
  const key = (await first.getAttribute("data-stream-key")) ?? "";
  const fromFloyd = () => feedItems(page).then((items) => items.filter((i) => i.space.name === "Floyd Civic Hub"));
  expect((await fromFloyd()).some((i) => i.streamKey === key)).toBe(true);
  await first.getByRole("button", { name: /^Mute / }).click();
  const muted = floyd.locator(`[data-stream-key="${key}"]`);
  await expect(muted).toContainText("Muted");
  await expect(muted).toContainText("until the process ends");
  const after = await fromFloyd();
  expect(after.length).toBeGreaterThan(0);
  expect(after.some((i) => i.streamKey === key)).toBe(false);

  // Unmute brings them back.
  await muted.getByRole("button", { name: /^Unmute / }).click();
  await expect(floyd.locator(`[data-stream-key="${key}"]`)).not.toContainText("Muted");
  expect((await fromFloyd()).some((i) => i.streamKey === key)).toBe(true);
});

test("check 18: a followed stream that ended shows under Ended, keeps its final result, and the Result survives retention", async ({ page, context }) => {
  await signUp(page, "check18");
  await openFollowing(page);
  await unfollow(page, "Floyd Civic Hub");

  const preview = await lookUp(page, FLOYD_VOTE);
  await expect(preview.getByRole("radio", { name: "Just this stream (ends on its own when the process ends)" })).toBeChecked();
  await confirm(page);

  // The vote has ended (the recorded End): the follow is under Ended, and Floyd isn't under Spaces.
  await expect(spaceRow(page, "Floyd Civic Hub")).toHaveCount(0);
  const tabs = page.getByRole("group", { name: "Show" });
  await expect(tabs.getByRole("button", { name: "Ended · 1" })).toBeVisible();
  await tabs.getByRole("button", { name: "Ended · 1" }).click();
  const ended = page.getByTestId("ended-row");
  await expect(ended).toHaveCount(1);
  await expect(ended).toHaveAttribute("data-stream-key", FLOYD_VOTE);
  await expect(ended).toContainText("Floyd Civic Hub");
  await expectNoSeriousAxeIssues(page);

  // End, then Aggregation, then Result all arrived; the Result is the final result.
  const items = (await feedItems(page)).filter((i) => i.streamKey === FLOYD_VOTE);
  const end = items.find((i) => i.civic?.activityType === "civic:End");
  const aggregation = items.find((i) => i.civic?.objectType === "hub:Aggregation");
  const result = items.find((i) => i.civic?.activityType === "Announce" && i.civic?.objectType === "civic:Result");
  expect(end && aggregation && result).toBeTruthy();
  expect(items.filter((i) => i.isFinalResult).map((i) => i.id)).toEqual([result!.id]);

  // The daily job 120 days on (as pg_cron runs it, rolled back): the Result stays, the rest goes.
  const account = await riverAccount(context);
  const kept = await withAdmin(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT river.daily_job(now() + interval '120 days')");
      const { rows } = await client.query<{ id: string }>(
        "SELECT i.id FROM river.items i JOIN river.spaces s ON s.id = i.space_id WHERE s.canonical_url = 'https://floyd.civic.social' AND i.stream_key = $1",
        [FLOYD_VOTE],
      );
      const follows = await client.query("SELECT 1 FROM river.follows WHERE account_id = $1 AND ended_at IS NOT NULL", [account]);
      return { ids: rows.map((r) => r.id), endedFollows: follows.rowCount };
    } finally {
      await client.query("ROLLBACK");
    }
  });
  expect(kept).toEqual({ ids: [result!.id], endedFollows: 0 });

  // Remove clears it from Ended.
  await ended.getByRole("button", { name: /^Remove / }).click();
  await expect(page.getByTestId("ended-row")).toHaveCount(0);
});

test("check 19: a space with nothing new in 90 days is Quiet; samples never are; Unfollow all quiet spaces", async ({ page, context }) => {
  await signUp(page, "check19");
  const account = await riverAccount(context);
  const quietName = `Quiet Hall ${randomUUID().slice(0, 6)}`;
  const oldSample = `Old Sample ${randomUUID().slice(0, 6)}`;
  await withAdmin(async (client) => {
    for (const [name, adapter, url] of [
      [quietName, "civic_hub", `https://quiet-e2e.invalid/${randomUUID()}`],
      [oldSample, "sample", `https://quiet-e2e-sample.invalid/${randomUUID()}`],
    ] as const) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO river.spaces (adapter, canonical_url, name, newest_item_at, last_fetched_at, fetch_status)
         VALUES ($1, $2, $3, '2026-01-01T00:00:00Z', now(), 'ok') RETURNING id`,
        [adapter, url, name],
      );
      await client.query("INSERT INTO river.follows (instance_id, account_id, space_id) VALUES ($1, $2, $3)", [
        SEED_INSTANCE,
        account,
        rows[0]!.id,
      ]);
    }
  });

  await openFollowing(page);
  const tabs = page.getByRole("group", { name: "Show" });
  await expect(tabs.getByRole("button", { name: "Quiet · 1" })).toBeVisible();
  const banner = page.getByRole("region", { name: "Quiet spaces" });
  await expect(banner).toContainText("1 space has posted nothing in 90 days.");
  await banner.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("space-row")).toHaveCount(1);
  await expect(spaceRow(page, quietName)).toBeVisible();
  await expect(spaceRow(page, oldSample)).toHaveCount(0);

  await page.getByRole("region", { name: "Quiet spaces" }).getByRole("button", { name: "Unfollow all quiet spaces" }).click();
  await expect(tabs.getByRole("button", { name: "Quiet · 0" })).toBeVisible();
  await expect(page.getByText("Every space you follow has posted in the last 90 days.")).toBeVisible();
  await tabs.getByRole("button", { name: /^Spaces/ }).click();
  await expect(spaceRow(page, quietName)).toHaveCount(0);
  await expect(spaceRow(page, oldSample)).toBeVisible();
  const left = await withAdmin(async (client) =>
    (
      await client.query<{ name: string }>(
        "SELECT s.name FROM river.follows f JOIN river.spaces s ON s.id = f.space_id WHERE f.account_id = $1 AND s.name = ANY($2)",
        [account, [quietName, oldSample]],
      )
    ).rows.map((r) => r.name),
  );
  expect(left).toEqual([oldSample]);
});

test("circles (F8): create, recolor, rename, add a space, filter by it, delete; the Civic circle can't be deleted", async ({ page }) => {
  await signUp(page, "circles");
  await openFollowing(page);
  const circles = page.getByRole("complementary", { name: "Circles" });
  await circles.getByRole("button", { name: "+ New circle" }).click();
  await circles.getByLabel("New circle name").fill("Book club");
  await circles.getByRole("radio", { name: "Green" }).check();
  await circles.getByRole("button", { name: "Create circle" }).click();
  const row = circles.getByTestId("circle-row").filter({ hasText: "Book club" });
  await expect(row).toContainText("0 spaces");

  await row.getByRole("button", { name: "Edit Book club" }).click();
  // The box changes once the River has saved it.
  await row.getByRole("checkbox", { name: "Demosville Civic Hub" }).click();
  await expect(row.getByRole("checkbox", { name: "Demosville Civic Hub" })).toBeChecked();
  await expect(row).toContainText("1 space");
  await row.getByLabel("Name").fill("Readers");
  await row.getByRole("radio", { name: "Purple" }).check();
  await row.getByRole("button", { name: "Save" }).click();
  const readers = circles.getByTestId("circle-row").filter({ hasText: "Readers" });
  await expect(readers).toContainText("1 space");
  await expect(spaceRow(page, "Demosville Civic Hub").getByRole("button", { name: /^Circles for Demosville Civic Hub:/ })).toContainText("Readers");
  await expectNoSeriousAxeIssues(page);

  // The Civic circle keeps its role when renamed and has no Delete.
  const civic = circles.getByTestId("circle-row").filter({ hasText: /^Civic/ });
  await expect(civic.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
  await civic.getByRole("button", { name: "Edit Civic" }).click();
  await civic.getByLabel("Name").fill("Town");
  await civic.getByRole("button", { name: "Save" }).click();
  await expect(circles.getByTestId("circle-row").filter({ hasText: "Town" })).toBeVisible();
  const roles = await page.evaluate(async () => ((await (await fetch("/api/following")).json()) as { circles: Array<{ name: string; role: string | null }> }).circles);
  expect(roles.find((c) => c.name === "Town")?.role).toBe("civic");

  // The River's circle filter has the new circle and shows only its space.
  await page.getByRole("link", { name: "Back to your River" }).click();
  const sidebar = page.getByRole("complementary", { name: "Filters" });
  await sidebar.getByRole("button", { name: "Readers" }).click();
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  // The previous view's cards stay until the filtered feed arrives, so wait for it.
  await expect
    .poll(async () => [...new Set(await cards(page).locator(".card-source").allTextContents())])
    .toEqual(["Demosville Civic Hub"]);

  // Delete it (the browser's confirm is accepted).
  await page.goto("/following");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("complementary", { name: "Circles" }).getByRole("button", { name: "Delete Readers" }).click();
  await expect(page.getByRole("complementary", { name: "Circles" }).getByTestId("circle-row").filter({ hasText: "Readers" })).toHaveCount(0);
});

test("check 15 on a phone: the Following tab's follow box previews @w3c@w3c.social; its posts show with boosts, replies hidden", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await addAuthenticator(page);
  await page.goto("/");
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  const tabs = page.getByRole("navigation", { name: "River sections" });
  // A visitor's Following tab asks them to sign up.
  await tabs.getByRole("button", { name: "Following" }).click();
  await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible();
  await page.getByRole("link", { name: "Sign up" }).click();
  await page.waitForURL(`${identityURL}/authorize?**`);
  await page.getByLabel("Email address").fill(testEmail("check15"));
  await page.getByRole("button", { name: "Create a passkey" }).click();
  await throughCallback(page, () => page.getByRole("link", { name: "Continue to Mosaic River" }).click());
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });

  // The header's Follow opens the Following tab with the follow box.
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(tabs.getByRole("button", { name: "Following" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("space-row").first()).toBeVisible({ timeout: 30_000 });
  await unfollow(page, "World Wide Web Consortium");

  const previewResponse = page.waitForResponse((r) => r.url().endsWith("/api/follow/preview"));
  const preview = await lookUp(page, "@w3c@w3c.social");
  const body = (await (await previewResponse).json()) as { preview: { iconUrl: string | null } };
  expect(body.preview.iconUrl).toMatch(/^https:\/\/w3csocial\.files\.fedi\.monster\//);
  await expect(preview.locator(".follow-preview-name")).toHaveText("World Wide Web Consortium");
  await expect(preview).toContainText("Mastodon account · @w3c@w3c.social");
  await expectNoSeriousAxeIssues(page);
  await confirm(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  const items = (await feedItems(page)).filter((i) => i.space.name === "World Wide Web Consortium");
  expect(items.length).toBeGreaterThan(0);
  expect(items.some((i) => i.boostOf)).toBe(true);
  const hidden = await withAdmin(async (client) =>
    (
      await client.query<{ id: string }>(
        "SELECT i.id FROM river.items i JOIN river.spaces s ON s.id = i.space_id WHERE s.canonical_url = 'https://w3c.social/users/w3c' AND i.hidden",
      )
    ).rows.map((r) => r.id),
  );
  expect(hidden.length).toBeGreaterThan(0);
  expect(items.some((i) => hidden.includes(i.id))).toBe(false);

  // The feed shows its boost cards: the boosted post where it could be fetched, else the plain card.
  await tabs.getByRole("button", { name: "Feed" }).click();
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("searchbox", { name: "Search your River" }).fill("World Wide Web Consortium");
  await page.getByRole("searchbox", { name: "Search your River" }).press("Enter");
  await expect(page.getByTestId("boost-line").first()).toHaveText("World Wide Web Consortium boosted");
  await expect(page.locator(".card-boost").filter({ hasText: "boosted a post from" }).first()).toBeVisible();

  // The Circles tab edits circles.
  await tabs.getByRole("button", { name: "Circles" }).click();
  await expect(page.getByTestId("circle-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("circle-row").filter({ hasText: "News and ideas" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

test("the Following page uses the whole window, as the River does (ui-revisions-8 item 3)", async ({ page }) => {
  await signUp(page, "following-edges");
  const gutter = 16; // --space-md
  for (const width of [1920, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await openFollowing(page);
    const right = await page.evaluate(() => document.body.getBoundingClientRect().width);
    const main = (await page.locator(".following-main").boundingBox())!;
    const circles = (await page.locator(".following-aside").boundingBox())!;
    // Circles against the right edge; the main column centred in the space left of them, at its
    // reading width (52rem).
    expect(right - (circles.x + circles.width), `${width}px`).toBeLessThanOrEqual(gutter);
    const spaceLeft = main.x;
    const spaceRight = circles.x - (main.x + main.width);
    expect(Math.abs(spaceLeft - spaceRight), `${width}px`).toBeLessThanOrEqual(gutter + 1);
    expect(main.width).toBeLessThanOrEqual(52 * 16 + 1);
    // The top bar spans the window too: the brand at the left edge, the profile menu at the right.
    const brand = (await page.locator(".topbar .brand").boundingBox())!;
    const profile = (await page.locator(".topbar").getByTestId("profile-button").boundingBox())!;
    expect(brand.x).toBeLessThanOrEqual(gutter);
    expect(right - (profile.x + profile.width)).toBeLessThanOrEqual(gutter);
  }
  // A phone keeps the one column, with no sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await openFollowing(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
