import { expect, test } from "./fixtures";

// M5: the feed API answers through the UI's /api proxy (the hostname the proxy sends must map to
// the seed instance), and the UI serves the sample placeholders the sample items point at.
test("the feed answers through /api with Live and Sample items, and sample images load", async ({ request }) => {
  const res = await request.get("/api/feed");
  expect(res.status()).toBe(200);
  const feed = (await res.json()) as {
    instance: { name: string };
    items: Array<{ source: string; media: Array<{ url: string; alt?: string }> }>;
  };
  expect(feed.instance.name).toBe("Mosaic River");
  expect(feed.items.some((i) => i.source === "live")).toBe(true);
  const sampleMedia = feed.items.filter((i) => i.source === "sample").flatMap((i) => i.media);
  expect(sampleMedia.length).toBeGreaterThan(0);
  for (const media of sampleMedia) {
    expect(media.alt).toBeTruthy();
    const image = await request.get(media.url);
    expect(image.status(), media.url).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/svg+xml");
  }
});
