// Boost, favourite and follow's words and choices (ui/src/lib/toggles.ts; fediverse-posting-1 items
// 2.2, 2.5 and 4; ADR-010 §8).
import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../../../ui/src/lib/activity";
import type { LinkedAccount } from "../../../ui/src/lib/linkedAccounts";
import { canUndo, defaultAccount, firstToggleNote, followLabel, toggleLabel, undoLabel } from "../../../ui/src/lib/toggles";

function account(overrides: Partial<LinkedAccount>): LinkedAccount {
  return {
    id: "l1",
    handle: "@ana@example.social",
    server: "example.social",
    displayName: null,
    avatarUrl: null,
    software: "Mastodon",
    scopes: [],
    status: "active",
    linkedAt: "2026-10-01T00:00:00.000Z",
    lastUsedAt: null,
    ...overrides,
  };
}

function entry(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: "a",
    at: "2026-11-15T12:00:00.000Z",
    channel: "fediverse",
    verb: "boost",
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

describe("defaultAccount (item 2.5)", () => {
  it("is the active account used last, else the one linked last", () => {
    const old = account({ id: "old", linkedAt: "2026-10-01T00:00:00.000Z", lastUsedAt: "2026-11-10T00:00:00.000Z" });
    const fresh = account({ id: "fresh", linkedAt: "2026-11-12T00:00:00.000Z" });
    const revoked = account({ id: "revoked", status: "revoked", lastUsedAt: "2026-11-14T00:00:00.000Z" });
    expect(defaultAccount([old, fresh, revoked])?.id).toBe("fresh");
    expect(defaultAccount([old, account({ id: "used", lastUsedAt: "2026-11-13T00:00:00.000Z" })])?.id).toBe("used");
    expect(defaultAccount([revoked])).toBeUndefined();
  });
});

describe("words", () => {
  it("names toggles, follows and item 4's note", () => {
    expect(toggleLabel("boost", false)).toBe("Boost");
    expect(toggleLabel("boost", true)).toBe("Boosted");
    expect(toggleLabel("favourite", true)).toBe("Favourited");
    expect(followLabel(null)).toBe("Follow");
    expect(followLabel({ following: true, requested: false })).toBe("Unfollow");
    expect(followLabel({ following: false, requested: true })).toBe("Requested");
    expect(firstToggleNote("@ana@example.social")).toBe(
      "Boosts, favourites and follows from the River are made publicly as @ana@example.social.",
    );
    expect(undoLabel("boost")).toBe("Undo this boost");
    expect(undoLabel("follow")).toBe("Unfollow");
  });
});

describe("canUndo (ADR-010 §8)", () => {
  it("offers Undo on a sent boost, favourite or follow from the fediverse only", () => {
    expect(canUndo(entry({}))).toBe(true);
    expect(canUndo(entry({ verb: "favourite" }))).toBe(true);
    expect(canUndo(entry({ verb: "follow" }))).toBe(true);
    expect(canUndo(entry({ status: "undone" }))).toBe(false);
    expect(canUndo(entry({ status: "unknown" }))).toBe(false);
    expect(canUndo(entry({ verb: "unboost" }))).toBe(false);
    expect(canUndo(entry({ verb: "post" }))).toBe(false);
    expect(canUndo(entry({ channel: "space", verb: "support" }))).toBe(false);
  });
});
