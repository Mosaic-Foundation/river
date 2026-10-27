// Your activity's words (ui/src/lib/activity.ts; ADR-010 §7 and §9: messages name the other side).
import { describe, expect, it } from "vitest";
import { statusText, targetText, verbLabel, type ActivityEntry } from "../../../ui/src/lib/activity";

function entry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: "a",
    at: "2026-10-27T12:00:00.000Z",
    channel: "fediverse",
    verb: "post",
    status: "sent",
    targetHost: "example.social",
    targetLabel: "@ana@example.social",
    subjectTitle: null,
    subjectUrl: null,
    remoteUrl: null,
    errorCode: null,
    errorMessage: null,
    undoesId: null,
    ...overrides,
  };
}

describe("Your activity", () => {
  it("names each verb, and an unknown one plainly", () => {
    expect(verbLabel("post")).toBe("Posted");
    expect(verbLabel("unboost")).toBe("Undid a boost");
    expect(verbLabel("poll_answer")).toBe("Answered a poll");
    expect(verbLabel("something-new")).toBe("Acted");
  });

  it("says who it was done as, or where", () => {
    expect(targetText(entry())).toBe("as @ana@example.social");
    expect(targetText(entry({ targetLabel: null }))).toBe("as example.social");
    expect(targetText(entry({ channel: "space", targetHost: "demosville.civic.social", targetLabel: null }))).toBe(
      "at demosville.civic.social",
    );
  });

  it("says how it went, naming the other side", () => {
    expect(statusText(entry())).toBe("Done on example.social");
    expect(statusText(entry({ channel: "space", targetHost: "demosville.civic.social" }))).toBe("Sent to demosville.civic.social");
    expect(statusText(entry({ status: "held", targetHost: "demosville.civic.social" }))).toBe(
      "demosville.civic.social will show it after review",
    );
    expect(statusText(entry({ status: "unknown" }))).toBe("We couldn't tell whether example.social got it");
    expect(statusText(entry({ status: "failed" }))).toBe("Didn't go. Nothing was sent.");
    expect(statusText(entry({ status: "failed", errorMessage: "<b>Too long</b>" }))).toBe(
      "Didn't go. example.social says: <b>Too long</b>",
    );
    expect(statusText(entry({ status: "undone" }))).toBe("Undone");
  });
});
