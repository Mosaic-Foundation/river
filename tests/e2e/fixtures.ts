import { test as base, expect, type BrowserContext } from "@playwright/test";

// Every e2e test runs with the outside world cut off: the browser may reach the River's own
// servers on loopback (localhost, 127.0.0.1, *.localhost for the unknown-host check) and nothing
// else. Requests to any other origin, such as a live item's image or avatar on a fediverse server,
// are aborted and recorded, so no test ever touches a real host. The API itself replays recorded
// responses (FETCH_FIXTURES_DIR, TEST_CLOCK_NOW in .env).
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d+)?\//;

export interface Blocked {
  url: string;
  resourceType: string;
}

/** Cuts a browser context off from everything but loopback; a test's own extra contexts use it too. */
export async function cutOff(context: BrowserContext, blocked: Blocked[]): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (LOOPBACK.test(url) || url.startsWith("data:") || url.startsWith("blob:")) {
      await route.continue();
      return;
    }
    blocked.push({ url, resourceType: request.resourceType() });
    await route.abort("blockedbyclient");
  });
}

export const test = base.extend<{ blocked: Blocked[] }>({
  blocked: [
    async ({ context }, use) => {
      const blocked: Blocked[] = [];
      await cutOff(context, blocked);
      await use(blocked);
      // Only images (straight from their source, spec 4.8) may even be attempted off-origin;
      // fonts, scripts, styles and API calls are all the River's own.
      expect(blocked.filter((b) => b.resourceType !== "image" && b.resourceType !== "document")).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
