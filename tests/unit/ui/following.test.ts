import { describe, expect, it } from "vitest";
import {
  CIRCLE_COLORS,
  importCountSentence,
  importDoneSentence,
  nextCircleColor,
  toggleId,
  type ImportPreview,
} from "../../../ui/src/lib/following";

// "Import from Bluesky" (docs/spec/bluesky-1.md item 4): the preview's count and the result's sentence.
const preview: ImportPreview = {
  account: { did: "did:plc:lr36xv2l64jwtnyoaqem6z2z", name: "EFF", handle: "eff.org", iconUrl: null },
  count: 234,
  skipped: 0,
  truncated: false,
  accounts: [],
};

describe("importCountSentence", () => {
  it("names the account by handle and counts", () => {
    expect(importCountSentence(preview)).toBe("@eff.org follows 234 accounts.");
    expect(importCountSentence({ ...preview, count: 1 })).toBe("@eff.org follows 1 account.");
  });

  it("says what was left out and when the list was cut", () => {
    expect(importCountSentence({ ...preview, skipped: 25, truncated: true, count: 1000 })).toBe(
      "@eff.org follows 1,000 accounts (the first 1,000 are listed). Left out: 25 accounts that show only to people signed in to Bluesky.",
    );
    expect(importCountSentence({ ...preview, skipped: 1 })).toContain("Left out: 1 account that");
  });

  it("uses the name when the handle didn't verify", () => {
    expect(importCountSentence({ ...preview, account: { ...preview.account, handle: null } })).toBe("EFF follows 234 accounts.");
  });
});

describe("importDoneSentence", () => {
  it("counts the new follows, the ones already followed and the circle", () => {
    const result = { total: 234, followed: 221, alreadyFollowing: 13, skipped: 0, truncated: false };
    expect(importDoneSentence(result, "Friends")).toBe(
      "You're now following 221 more accounts (13 you already followed), in Friends. Their posts fill in over your next visits.",
    );
    expect(importDoneSentence({ ...result, followed: 1, alreadyFollowing: 0 }, null)).toBe(
      "You're now following 1 more account. Their posts fill in over your next visits.",
    );
  });
});

// A Following row's circles menu (docs/spec/ui-revisions-7.md).
describe("circles menu helpers", () => {
  it("toggleId adds an id that's missing and removes one that's there", () => {
    expect(toggleId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleId([], "a")).toEqual(["a"]);
  });

  it("a new circle gets the first color no circle uses, ignoring case", () => {
    expect(nextCircleColor([])).toBe("#2F6FA8");
    expect(nextCircleColor([{ color: "#2f6fa8" }, { color: null }, { color: "#7A5AA6" }])).toBe("#C2603A");
  });

  it("once every color is used, the list goes round again", () => {
    const all = CIRCLE_COLORS.map((c) => ({ color: c.value }));
    expect(nextCircleColor(all)).toBe(CIRCLE_COLORS[0]!.value);
    expect(nextCircleColor([...all, { color: null }])).toBe(CIRCLE_COLORS[1]!.value);
  });
});
