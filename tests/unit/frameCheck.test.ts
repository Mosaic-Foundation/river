// The framing check (ui-revisions-2 item 2, ADR-008). framingAllowed reads response headers the
// way a browser does; checkFraming asks a stored item's page once through the real fetch guard.
// Recorded pages: a socialwebfoundation.org article (no X-Frame-Options, no frame-ancestors) and
// a Longmont Civic Hub meeting summary (DENY and frame-ancestors 'none'), from
// `npm run record-fixtures -- --frames`. Responses marked DERIVED are test-only variants of those.
import { beforeEach, describe, expect, it } from "vitest";
import { checkFraming, clearFrameCache, FRAME_CACHE_MS, FRAME_RETRY_MS } from "../../src/river/frame/check.js";
import { frameAncestorLists, framingAllowed } from "../../src/river/frame/policy.js";
import { derived, recordedFixture, replayGuard } from "./helpers/fediverseFixtures.js";

const RIVER = "https://river.mosaic.social";
const PAGE = "https://example.org/post";
const ARTICLE = "https://socialwebfoundation.org/2026/10/13/fosdem-2027-dev-room-application-is-in/";
const HUB_PAGE = "https://longmont.civic.social/meeting-summary/proc_4ebb11759c4c40ce";

function allowed(headers: Record<string, string>, ancestor = RIVER, page = PAGE): boolean {
  return framingAllowed(new Headers(headers), page, ancestor);
}

describe("framingAllowed: X-Frame-Options", () => {
  it("allows a page with neither header", () => {
    expect(allowed({})).toBe(true);
  });

  it("refuses DENY and SAMEORIGIN, in any case, and when repeated", () => {
    expect(allowed({ "x-frame-options": "DENY" })).toBe(false);
    expect(allowed({ "x-frame-options": "sameorigin" })).toBe(false);
    expect(allowed({ "x-frame-options": "SAMEORIGIN, SAMEORIGIN" })).toBe(false);
  });

  it("allows ALLOWALL; refuses ALLOW-FROM and other values (browsers ignore them, the River doesn't guess)", () => {
    expect(allowed({ "x-frame-options": "ALLOWALL" })).toBe(true);
    expect(allowed({ "x-frame-options": "ALLOW-FROM https://river.mosaic.social" })).toBe(false);
    expect(allowed({ "x-frame-options": "nonsense" })).toBe(false);
  });
});

describe("framingAllowed: CSP frame-ancestors", () => {
  it("refuses 'none' and 'self'", () => {
    expect(allowed({ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" })).toBe(false);
    expect(allowed({ "content-security-policy": "frame-ancestors 'self'" })).toBe(false);
  });

  it("allows *, https: and a host source naming the River", () => {
    expect(allowed({ "content-security-policy": "frame-ancestors *" })).toBe(true);
    expect(allowed({ "content-security-policy": "frame-ancestors https:" })).toBe(true);
    // http: covers https: too (CSP3 scheme upgrade).
    expect(allowed({ "content-security-policy": "frame-ancestors http:" })).toBe(true);
    expect(allowed({ "content-security-policy": "frame-ancestors 'self' https://river.mosaic.social" })).toBe(true);
    expect(allowed({ "content-security-policy": "frame-ancestors river.mosaic.social" })).toBe(true);
    expect(allowed({ "content-security-policy": "frame-ancestors *.mosaic.social" })).toBe(true);
    expect(allowed({ "content-security-policy": "frame-ancestors https://river.mosaic.social:443/" })).toBe(true);
    expect(allowed({ "content-security-policy": "frame-ancestors https://river.mosaic.social:*" })).toBe(true);
  });

  it("refuses sources that leave the River out", () => {
    for (const sources of [
      "https://partner.example",
      "*.example.org",
      "data:",
      "https://river.mosaic.social:8443",
      "https://mosaic.social",
      "https://river.mosaic.social/embed",
      "'unsafe-inline'",
      "",
    ]) {
      expect(allowed({ "content-security-policy": `frame-ancestors ${sources}` }), sources).toBe(false);
    }
  });

  it("frame-ancestors overrides X-Frame-Options, both ways", () => {
    expect(allowed({ "content-security-policy": "frame-ancestors *", "x-frame-options": "DENY" })).toBe(true);
    expect(allowed({ "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "ALLOWALL" })).toBe(false);
  });

  it("a policy without frame-ancestors leaves the decision to X-Frame-Options", () => {
    expect(allowed({ "content-security-policy": "default-src 'none'" })).toBe(true);
    expect(allowed({ "content-security-policy": "default-src 'none'", "x-frame-options": "DENY" })).toBe(false);
  });

  it("every enforced policy must allow it (several headers arrive comma-joined)", () => {
    expect(allowed({ "content-security-policy": "frame-ancestors *, frame-ancestors 'none'" })).toBe(false);
    expect(allowed({ "content-security-policy": "default-src 'self', frame-ancestors https:" })).toBe(true);
    expect(frameAncestorLists("frame-ancestors a b; frame-ancestors c, script-src 'self'")).toEqual([["a", "b"]]);
  });

  it("ignores Content-Security-Policy-Report-Only", () => {
    expect(allowed({ "content-security-policy-report-only": "frame-ancestors 'none'" })).toBe(true);
  });

  it("matches the River's local origin in development (http, with a port)", () => {
    const local = "http://localhost:5173";
    expect(allowed({ "content-security-policy": "frame-ancestors http://localhost:5173" }, local)).toBe(true);
    expect(allowed({ "content-security-policy": "frame-ancestors localhost:5173" }, local)).toBe(false);
    expect(allowed({ "content-security-policy": "frame-ancestors http://localhost" }, local)).toBe(false);
    expect(allowed({ "content-security-policy": "frame-ancestors *" }, local)).toBe(true);
  });

  it("reads the recorded pages: the hub refuses, the article allows", () => {
    const hub = recordedFixture(HUB_PAGE);
    const article = recordedFixture(ARTICLE);
    expect(framingAllowed(new Headers(hub.headers), HUB_PAGE, RIVER)).toBe(false);
    expect(framingAllowed(new Headers(article.headers), ARTICLE, RIVER)).toBe(true);
  });
});

describe("checkFraming", () => {
  beforeEach(() => clearFrameCache());

  it("frames the recorded article, asking its page once with the River's guard", async () => {
    const replay = replayGuard();
    await expect(checkFraming(ARTICLE, RIVER, { guard: replay.guard })).resolves.toEqual({ frame: true, url: ARTICLE });
    expect(replay.calls).toEqual([`GET ${ARTICLE}`]);
  });

  it("refuses the recorded Civic Hub page", async () => {
    const replay = replayGuard();
    await expect(checkFraming(HUB_PAGE, RIVER, { guard: replay.guard })).resolves.toEqual({ frame: false, reason: "refused" });
  });

  it("an unreachable host, an error status or a page that isn't HTML opens the reader", async () => {
    // DERIVED: the recorded article answering 404, as a PDF, and as a download.
    const missing = replayGuard([derived(ARTICLE, { status: 404 })]);
    await expect(checkFraming(ARTICLE, RIVER, { guard: missing.guard })).resolves.toEqual({ frame: false, reason: "unreachable" });
    clearFrameCache();
    const pdf = replayGuard([derived(ARTICLE, { headers: { "content-type": "application/pdf" } })]);
    await expect(checkFraming(ARTICLE, RIVER, { guard: pdf.guard })).resolves.toEqual({ frame: false, reason: "not_page" });
    clearFrameCache();
    const download = replayGuard([derived(ARTICLE, { headers: { "content-disposition": "attachment; filename=post.html" } })]);
    await expect(checkFraming(ARTICLE, RIVER, { guard: download.guard })).resolves.toEqual({ frame: false, reason: "not_page" });
    clearFrameCache();
    // mas.to isn't recorded: it doesn't resolve in replay.
    const elsewhere = replayGuard();
    await expect(
      checkFraming("https://mas.to/@sphcow/117451397579521952", RIVER, { guard: elsewhere.guard }),
    ).resolves.toEqual({ frame: false, reason: "unreachable" });
  });

  it("the guard's checks still apply: a private address is never asked", async () => {
    const replay = replayGuard();
    await expect(checkFraming("https://127.0.0.1/admin", RIVER, { guard: replay.guard })).resolves.toEqual({
      frame: false,
      reason: "unreachable",
    });
    expect(replay.calls).toEqual([]);
  });

  it("frames the page a redirect ends on", async () => {
    // DERIVED: a short link on the article's host that redirects to it.
    const short = "https://socialwebfoundation.org/?p=207118-short";
    const replay = replayGuard([derived(short, { from: ARTICLE, status: 301, headers: { location: ARTICLE }, body: "" })]);
    await expect(checkFraming(short, RIVER, { guard: replay.guard })).resolves.toEqual({ frame: true, url: ARTICLE });
    expect(replay.calls).toEqual([`GET ${short}`, `GET ${ARTICLE}`]);
  });

  it("reuses an answer for ten minutes, and retries an unreachable page after one", async () => {
    let now = 1_000_000;
    const replay = replayGuard();
    const deps = { guard: replay.guard, now: () => now };
    await checkFraming(ARTICLE, RIVER, deps);
    now += FRAME_CACHE_MS - 1;
    await checkFraming(ARTICLE, RIVER, deps);
    expect(replay.calls).toHaveLength(1);
    now += 2;
    await checkFraming(ARTICLE, RIVER, deps);
    expect(replay.calls).toHaveLength(2);

    const gone = "https://socialwebfoundation.org/not-recorded/";
    await checkFraming(gone, RIVER, deps);
    now += FRAME_RETRY_MS + 1;
    await checkFraming(gone, RIVER, deps);
    expect(replay.calls.filter((c) => c.endsWith("/not-recorded/"))).toHaveLength(2);
  });
});
