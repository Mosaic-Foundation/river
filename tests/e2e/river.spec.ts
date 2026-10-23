import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// M6, the River UI (spec F1, F4, F5, 4.8, Appendix B; checks 3, 4, 21, 26, 30, 31 and the visitor
// half of 23). The API replays recorded responses; the fixture blocks every outside origin, so
// live items' images and avatars never load here and the cards must render without them.

const EXPLAINER =
  "This isn't linked to a real feed. It's here to show how the River works for a soccer club, a family or a podcast.";
const PHONE = { width: 390, height: 844 };

async function openFeed(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
}

function cards(page: Page): Locator {
  return page.getByTestId("feed-card");
}

/** Waits until every <img> on the page has loaded (failed ones are removed, so none is broken). */
async function expectNoBrokenImages(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.images]
          .filter((img) => img.loading !== "lazy" || img.getBoundingClientRect().top < window.innerHeight)
          .map((img) => ({ src: img.currentSrc || img.src, ok: img.complete && img.naturalWidth > 0 }))
          .filter((img) => !img.ok),
      ),
    )
    .toEqual([]);
}

test.describe("feed cards", () => {
  test("check 3: the Sample label opens the F1 explainer; Escape closes it and focus returns", async ({ page }) => {
    await openFeed(page);
    const label = page.getByRole("button", { name: "Sample", exact: true }).first();
    await label.click();
    const dialog = page.getByRole("dialog", { name: "Sample entry" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(EXPLAINER);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(label).toBeFocused();

    // From the keyboard too, and "Got it" closes it.
    await label.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Got it" }).press("Enter");
    await expect(dialog).toBeHidden();
    await expect(label).toBeFocused();
  });

  test("check 4 (as revised by ui-revisions-1 item 1 and ui-revisions-3 item 1): cards name their host; Open ↗ opens the original in a new tab", async ({ page }) => {
    await openFeed(page);
    const live = cards(page).and(page.locator('[data-source="live"]'));
    const sample = cards(page).and(page.locator('[data-source="sample"]'));
    expect(await live.count()).toBeGreaterThan(0);
    expect(await sample.count()).toBeGreaterThan(0);

    for (const card of await live.all()) {
      await expect(card.getByText("Live", { exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Sample", exact: true })).toHaveCount(0);
      const host = (await card.getByTestId("card-host").textContent())!;
      expect(host).toMatch(/^[a-z0-9.-]+\.[a-z]+$/);
      // Open ↗: the item URL, https, on that host, a new tab, noopener noreferrer.
      const open = card.getByRole("link", { name: `Open on ${host} (opens in a new tab)` });
      await expect(open).toBeVisible();
      const href = (await open.getAttribute("href"))!;
      expect(new URL(href).protocol).toBe("https:");
      expect(new URL(href).host).toBe(host);
      await expect(open).toHaveAttribute("target", "_blank");
      expect((await open.getAttribute("rel"))!.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    }
    for (const card of await sample.all()) {
      await expect(card.getByRole("button", { name: "Sample", exact: true })).toBeVisible();
      await expect(card.getByText("Live", { exact: true })).toHaveCount(0);
      await expect(card.getByTestId("card-host")).toHaveCount(0);
      await expect(card.getByRole("link", { name: /^Open on / })).toHaveCount(0);
    }

  });

  test("cards show source, kind, relative time; boosts say who boosted from where", async ({ page }) => {
    await openFeed(page);
    for (const card of await cards(page).all()) {
      await expect(card.locator(".card-source")).not.toBeEmpty();
      await expect(card.locator(".card-kind")).toHaveText(/^(Post|Article|Podcast|Video|Photo|Event|Civic activity)$/);
      await expect(card.locator("time").first()).toHaveText(/ago|yesterday|just now|last|in /);
    }
    // "{booster} boosted" above a fetched post, or the plain "boosted a post from {host}" card.
    const boost = page.locator(".card-boost").first();
    await expect(boost).toBeVisible();
    await expect(boost).toHaveText(/^.+ boosted( a post from [a-z0-9.-]+\.[a-z]+)?$/);
    // Avatars from outside hosts were blocked: the card falls back to initials. Avatars load
    // lazily, so the card is scrolled into view for its avatar to be requested at all.
    const live = cards(page).and(page.locator('[data-source="live"]')).first();
    await live.scrollIntoViewIfNeeded();
    await expect(live.locator(".source-icon-initials")).toHaveText(/^[A-Z0-9]{1,2}$/);
  });

  test("check 21: a card whose image fails to load renders without it, with no broken image", async ({ page }) => {
    // One sample image fails from the River's own origin; every live image is blocked by the fixture.
    await page.route("**/samples/ledger-library.svg", (route) => route.fulfill({ status: 404, body: "" }));
    await openFeed(page);
    const article = cards(page).filter({ hasText: "Library extends weekend hours through the winter" });
    await article.scrollIntoViewIfNeeded();
    await expect(article.getByRole("heading", { name: "Library extends weekend hours through the winter" })).toBeVisible();
    await expect(article.locator("img")).toHaveCount(0);
    await expect(article.getByTestId("card-media")).toHaveCount(0);

    // A live photo whose image (on its own server) can't load keeps its text and link.
    const livePhoto = cards(page).and(page.locator('[data-source="live"][data-kind="photo"]')).first();
    await livePhoto.scrollIntoViewIfNeeded();
    await expect(livePhoto.locator("img")).toHaveCount(0);
    await expect(livePhoto.getByTestId("card-host")).toBeVisible();

    // Images that did load are real images with lazy loading, no referrer and alt text.
    const sampleImage = page.locator('img[src^="/samples/"]').first();
    await sampleImage.scrollIntoViewIfNeeded();
    await expect(sampleImage).toHaveAttribute("loading", "lazy");
    await expect(sampleImage).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(sampleImage).toHaveAttribute("alt", /.+/);
    for (const card of (await cards(page).all()).slice(0, 12)) {
      await card.scrollIntoViewIfNeeded();
      await expectNoBrokenImages(page);
    }
  });

  test("Load more pages with the cursor, from the keyboard", async ({ page }) => {
    await openFeed(page);
    const before = await cards(page).count();
    const more = page.getByRole("button", { name: "Load more" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => cards(page).count()).toBeGreaterThan(before);
  });
});

test.describe("filters and empty state", () => {
  test("circle AND content type filter; the empty-state text comes from the API", async ({ page }) => {
    await openFeed(page);
    const sidebar = page.getByRole("complementary", { name: "Filters" });
    await sidebar.getByRole("button", { name: "News and ideas" }).click();
    await sidebar.getByRole("button", { name: "Podcasts" }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toHaveAttribute("data-kind", "podcast");
    await expect(cards(page).first().getByText("38 min")).toBeVisible();
    await expect(page).toHaveURL(/circle=News\+and\+ideas/);

    // Circles toggle (ui-revisions-4 item 1): News and ideas off, Soccer on.
    await sidebar.getByRole("button", { name: "News and ideas" }).click();
    await sidebar.getByRole("button", { name: "Soccer" }).click();
    await expect(page).toHaveURL(/\?circle=Soccer&type=podcasts$/);
    const feed = await page.request.get("/api/feed?circle=Soccer&type=podcasts");
    const { emptyMessage } = (await feed.json()) as { emptyMessage: string };
    await expect(page.getByRole("status")).toHaveText(emptyMessage);
    await expect(cards(page)).toHaveCount(0);
  });

  test("spec 4.3: a boost shows the boosted post under its original author, below '{booster} boosted'; Open ↗ is that post", async ({ page }) => {
    // @w3c boosted this @w3cdevs post (recorded); the refresh fetched the post and its author.
    await openFeed(page);
    const search = page.getByRole("searchbox", { name: "Search your River" });
    await search.fill("trigger CSS animations");
    await search.press("Enter");
    const card = cards(page).filter({ hasText: "Want to trigger CSS animations" }).first();
    await expect(card.getByTestId("boost-line")).toHaveText("World Wide Web Consortium boosted");
    await expect(card.locator(".card-boost + .card-header")).toHaveCount(1);
    await expect(card.locator(".card-source")).toHaveText("W3C Developers");
    // The avatar's host is blocked here, so the original author's initials stand in.
    await expect(card.locator(".source-icon-initials")).toHaveText("WD");
    await expect(card).toHaveAttribute("aria-label", "Post from W3C Developers");
    await expect(card).not.toContainText("boosted a post from");
    await expect(card).not.toContainText("The boosted post opens where it lives.");

    await expectNoSeriousAxeIssues(page);
    // A fediverse post stays in the feed (ui-revisions-3 item 1); Open ↗ is the boosted post.
    await expect(card).toHaveAttribute("data-open", "none");
    await expect(card.getByTestId("card-open")).toHaveAttribute("href", "https://w3c.social/@w3cdevs/117471856565477515");

    // The reader shows a boost the same way. It shows only at the address of an item without a
    // live page now, so the stored item is served without its URL here (a search that matches
    // nothing keeps it out of the loaded feed, so it comes from GET /api/items/{id}).
    const id = (await card.getAttribute("data-item-id"))!;
    await page.route(`**/api/items/${id}`, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { item: Record<string, unknown> };
      await route.fulfill({ response: res, json: { item: { ...body.item, url: null } } });
    });
    await page.goto(`/item/${id}?q=no-such-words-anywhere`);
    const reader = page.getByTestId("reader");
    await expect(reader.getByRole("heading", { level: 1 })).toHaveText("Post from W3C Developers", { timeout: 30_000 });
    await expect(reader.getByTestId("boost-line")).toHaveText("World Wide Web Consortium boosted");
    await expect(reader.getByTestId("reader-source")).toHaveText("W3C Developers");
    await expect(reader.getByTestId("reader-author")).toHaveText("By W3C Developers @w3cdevs@w3c.social");
    await expect(reader.locator(".reader-content").first()).toContainText("Want to trigger CSS animations");
    await expectNoSeriousAxeIssues(page);
  });

  test("search narrows the feed to matching items", async ({ page }) => {
    await openFeed(page);
    const search = page.getByRole("searchbox", { name: "Search your River" });
    await search.fill("budget");
    await search.press("Enter");
    await expect(cards(page).first()).toContainText("How a town budget gets made");
    for (const card of await cards(page).all()) await expect(card).toContainText(/budget/i);
  });
});

test.describe("read state (visitor)", () => {
  test("Mark read and opening an item stay in this browser, with no server write", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname.startsWith("/api/")) apiCalls.push(`${req.method()} ${new URL(req.url()).pathname}`);
    });
    await openFeed(page);
    const first = cards(page).first();
    await expect(first.getByTestId("unread-dot")).toBeVisible();
    await first.getByRole("button", { name: "Mark read" }).click();
    await expect(first.getByTestId("unread-dot")).toHaveCount(0);
    await expect(first.getByRole("button", { name: "Mark unread" })).toBeVisible();

    // Opening a live item (Open ↗, ui-revisions-3 item 1) marks it read.
    const live = cards(page).and(page.locator('[data-source="live"]')).nth(1);
    const liveId = (await live.getAttribute("data-item-id"))!;
    const popup = page.context().waitForEvent("page");
    await live.getByTestId("card-open").click();
    await (await popup).close();
    await expect(page.locator(`[data-item-id="${liveId}"]`).getByTestId("unread-dot")).toHaveCount(0);

    await page.reload();
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    await expect(cards(page).first().getByTestId("unread-dot")).toHaveCount(0);

    // "Mark all read" is gone (ui-revisions-5 item 1); the two marks are in this browser only.
    await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-river:read") ?? "[]") as string[]);
    expect(stored.sort()).toEqual([(await cards(page).first().getAttribute("data-item-id"))!, liveId].sort());

    expect(apiCalls.length).toBeGreaterThan(0);
    // Reads only: the feed (a Mastodon post needs no framing check, ui-revisions-2 item 2).
    expect(apiCalls.every((call) => call === "GET /api/feed")).toBe(true);
  });
});

test.describe("hosts and pages", () => {
  test("check 26: an unknown hostname gets the 404 page; localhost gets the seed instance in Mosaic", async ({ page, baseURL }) => {
    const unknown = new URL(baseURL!);
    unknown.hostname = "unknown.localhost";
    await page.goto(unknown.href);
    await expect(page.getByTestId("not-found")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("There is no River at this address.");
    await expect(page.getByTestId("feed-card")).toHaveCount(0);
    await expect(page).toHaveTitle(/Not found/);

    await openFeed(page, "/");
    expect(await page.locator("html").getAttribute("data-theme")).toBe("mosaic");
    const feed = (await (await page.request.get("/api/feed")).json()) as { instance: { name: string } };
    expect(feed.instance.name).toBe("Mosaic River");
    await expect(page).toHaveTitle("Everything · Mosaic River");
  });

  test("a path the River doesn't have shows the 404 page with a way home", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page doesn't exist.");
    await page.getByRole("link", { name: "Go to the River" }).click();
    await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
  });

  test("CSP: the page is served with the Appendix B policy and loads without a violation", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });
    const res = await page.goto("/");
    const csp = res!.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/(^|; )script-src 'self'( 'nonce-[^']+')?(;|$)/);
    expect(csp).toMatch(/(^|; )img-src 'self' https:(;|$)/);
    expect(csp).toMatch(/(^|; )media-src 'self' https:(;|$)/);
    // Opened items frame their https source (ui-revisions-2 item 2); nothing else may be framed.
    expect(csp).toMatch(/(^|; )frame-src https:(;|$)/);
    expect(csp).toMatch(/(^|; )connect-src 'self'(;|$)/);
    expect(csp).not.toContain("unsafe-inline");
    await expect(page.getByTestId("feed-card").first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Sample", exact: true }).first().click();
    await page.keyboard.press("Escape");
    expect(violations).toEqual([]);
  });
});

test.describe("phone (390 px)", () => {
  test.use({ viewport: PHONE });

  test("check 30: no horizontal scroll, bottom tabs visible, circle and type filters reachable", async ({ page }) => {
    await openFeed(page);
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);

    const tabs = page.getByRole("navigation", { name: "River sections" });
    await expect(tabs).toBeVisible();
    for (const name of ["Feed", "Circles", "Following", "You"]) {
      await expect(tabs.getByRole("button", { name })).toBeInViewport();
    }
    await expect(page.getByRole("complementary", { name: "Filters" })).toBeHidden();

    const chips = page.getByRole("group", { name: "Filters" });
    await chips.getByRole("list", { name: "Content type" }).getByRole("button", { name: "Podcasts" }).click();
    await chips.getByRole("button", { name: "News and ideas" }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toHaveAttribute("data-kind", "podcast");
    expect(await overflow()).toBeLessThanOrEqual(0);

    // The header's search and Follow.
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("searchbox", { name: "Search your River" })).toBeVisible();
    await page.getByRole("button", { name: "Follow", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Follow a Space" })).toBeVisible();
    await page.keyboard.press("Escape");

    // The other tabs say what comes later; Feed brings the feed back.
    await tabs.getByRole("button", { name: "Following" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Following" })).toBeVisible();
    await expect(tabs.getByRole("button", { name: "Following" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("button", { name: "Feed" }).click();
    await expect(cards(page).first()).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test("the whole unfiltered feed fits 390 px", async ({ page }) => {
    await openFeed(page);
    await page.getByRole("button", { name: "Load more" }).click();
    await expect.poll(() => cards(page).count()).toBeGreaterThan(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

// Check 31 (feed page; the Following and sign-in pages arrive in M8 and M9).
async function expectNoSeriousAxeIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(serious).toEqual([]);
}

/** Tabs through the page and checks that every visible control receives focus. */
async function expectAllControlsReachable(page: Page): Promise<void> {
  const total = await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]"),
    ].filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.checkVisibility());
    controls.forEach((el, i) => (el.dataset.kb = String(i)));
    return controls.length;
  });
  expect(total).toBeGreaterThan(5);
  const reached = new Set<string>();
  await page.locator("body").focus();
  for (let i = 0; i < total * 2 + 5 && reached.size < total; i++) {
    await page.keyboard.press("Tab");
    const kb = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.kb);
    if (kb !== undefined) reached.add(kb);
  }
  const missing = await page.evaluate(
    (seen) =>
      [...document.querySelectorAll<HTMLElement>("[data-kb]")]
        .filter((el) => !seen.includes(el.dataset.kb!))
        .map((el) => el.outerHTML.slice(0, 120)),
    [...reached],
  );
  expect(missing).toEqual([]);
}

test.describe("check 31: accessibility", () => {
  test("desktop feed: axe finds no critical or serious issue; every control is keyboard-reachable", async ({ page }) => {
    await openFeed(page);
    await expectNoSeriousAxeIssues(page);
    await page.getByRole("button", { name: "Sample", exact: true }).first().click();
    await expectNoSeriousAxeIssues(page);
    await page.keyboard.press("Escape");

    await openFeed(page, "/?circle=News+and+ideas");
    await expectAllControlsReachable(page);
  });

  test("phone feed and its tabs: axe and keyboard", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openFeed(page);
    await expectNoSeriousAxeIssues(page);
    await page.getByRole("button", { name: "You" }).click();
    await expectNoSeriousAxeIssues(page);
    await page.getByRole("button", { name: "Feed" }).click();

    await openFeed(page, "/?circle=Soccer");
    await expectAllControlsReachable(page);
  });

  test("the 404 page", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expectNoSeriousAxeIssues(page);
  });
});
