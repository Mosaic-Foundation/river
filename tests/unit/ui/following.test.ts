import { describe, expect, it } from "vitest";
import { importCountSentence, importDoneSentence, type ImportPreview } from "../../../ui/src/lib/following";

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
