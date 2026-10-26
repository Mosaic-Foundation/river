// The River's fixed-window rate limits (src/river/rateLimit.ts; security review of 3a86e8f, item 3).
import { afterEach, describe, expect, it } from "vitest";
import { hit, LIMITS, resetRateLimits } from "../../src/river/rateLimit.js";

afterEach(() => resetRateLimits());

describe("the River's rate limits", () => {
  it("allows max hits per window per key, then refuses until the window ends", () => {
    const { max, windowMs } = LIMITS.blueskyImport;
    const t = 1_000_000;
    for (let i = 0; i < max; i++) expect(hit("blueskyImport", "a", t + i)).toBe(true);
    expect(hit("blueskyImport", "a", t + max)).toBe(false);
    expect(hit("blueskyImport", "b", t + max)).toBe(true);
    expect(hit("blueskyPreview", "a", t + max)).toBe(true);
    expect(hit("blueskyImport", "a", t + windowMs)).toBe(true);
  });
});
