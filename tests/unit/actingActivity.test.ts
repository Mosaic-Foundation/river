// Your activity's server helpers (src/river/acting/activity.ts): the page cursor and the https-only
// links. The list itself runs against the database: tests/api/activity.test.ts.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ActivityCursorError, decodeCursor, encodeCursor, httpsOrNull } from "../../src/river/acting/activity.js";

describe("activity cursor", () => {
  it("round-trips a time and an id", () => {
    const cursor = { at: new Date("2026-10-27T12:00:00.123Z"), id: randomUUID() };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("refuses anything it didn't make", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    for (const bad of ["", "nonsense", b64("2026-10-27T12:00:00Z"), b64(`not a date|${randomUUID()}`), b64("2026-10-27T12:00:00Z|nope"), b64(`2026-10-27T12:00:00Z|${randomUUID()}|x`), "a".repeat(201)]) {
      expect(() => decodeCursor(bad), bad).toThrow(ActivityCursorError);
    }
  });
});

describe("httpsOrNull", () => {
  it("keeps https URLs and drops everything else", () => {
    expect(httpsOrNull("https://example.social/@ana/1")).toBe("https://example.social/@ana/1");
    for (const bad of ["http://example.social/x", "javascript:alert(1)", "data:text/html,x", "//example.social/x", "not a url"]) {
      expect(httpsOrNull(bad), bad).toBeNull();
    }
    expect(httpsOrNull(null)).toBeNull();
  });
});
