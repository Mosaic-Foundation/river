// ADR-010 §9's limit table and each verb's kind (src/river/acting/limits.ts). The counting itself
// runs in the database: tests/api/db/actingLimits.test.ts.
import { describe, expect, it } from "vitest";
import { ACT_LIMITS, PREVIEW_TTL_MS, VERBS, limitKindOf } from "../../src/river/acting/limits.js";

describe("acting limits", () => {
  it("match ADR-010 §9's table", () => {
    const minutes = (ms: number) => ms / 60_000;
    expect(Object.fromEntries(Object.entries(ACT_LIMITS).map(([k, ws]) => [k, ws.map((w) => [w.max, minutes(w.ms)])]))).toEqual({
      text: [[30, 60], [100, 1440]],
      toggle: [[120, 60], [600, 1440]],
      follow: [[50, 1440]],
      delete: [[30, 30]],
    });
    expect(minutes(PREVIEW_TTL_MS)).toBe(15);
  });

  it("puts every verb in its kind; every undo but delete is a toggle", () => {
    expect(Object.fromEntries(VERBS.map((v) => [v, limitKindOf(v)]))).toEqual({
      post: "text",
      reply: "text",
      comment: "text",
      poll_answer: "text",
      boost: "toggle",
      unboost: "toggle",
      favourite: "toggle",
      unfavourite: "toggle",
      support: "toggle",
      rsvp: "toggle",
      withdraw: "toggle",
      follow: "follow",
      unfollow: "follow",
      delete: "delete",
    });
  });
});
