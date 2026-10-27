// The composer's counter and words (ui/src/lib/compose.ts; fediverse-posting-1.md items 3 and 7,
// check 6's counting half).
import { describe, expect, it } from "vitest";
import { characterCount, refusalText, replyStart, requestText, type ComposeAccount } from "../../../ui/src/lib/compose";

const mastodon: Pick<ComposeAccount, "software" | "limits"> = { software: "mastodon", limits: { maxCharacters: 500, charactersReservedPerUrl: 23 } };
const gts: Pick<ComposeAccount, "software" | "limits"> = { software: "gotosocial", limits: { maxCharacters: 5000, charactersReservedPerUrl: 23 } };

describe("characterCount", () => {
  it("counts a 40-character URL as 23 on Mastodon, and the content warning (check 6)", () => {
    const url = "https://example.com/abcdefghijklmnopqrst"; // 40 characters
    expect(url.length).toBe(40);
    expect(characterCount(url, "", mastodon)).toBe(23);
    expect(characterCount(`See ${url}`, "", mastodon)).toBe(27);
    expect(characterCount("Hi", "CW", mastodon)).toBe(4);
  });

  it("counts a mention @user@domain as @user on Mastodon", () => {
    expect(characterCount("@ana@example.social hi", "", mastodon)).toBe("@ana hi".length);
  });

  it("counts plain characters elsewhere, emoji as one", () => {
    const url = "https://example.com/abcdefghijklmnopqrst";
    expect(characterCount(url, "", gts)).toBe(40);
    expect(characterCount("😀😀", "", gts)).toBe(2);
  });
});

describe("words", () => {
  it("starts a reply with the mention", () => {
    expect(replyStart({ itemId: "i", title: "t", url: null, spoilerText: "", mention: "@poster@remote.example" })).toBe("@poster@remote.example ");
    expect(replyStart(null)).toBe("");
  });

  it("shows the exact request", () => {
    expect(requestText({ method: "POST", url: "https://example.social/api/v1/statuses", body: { status: "Hi", visibility: "public" } })).toBe(
      'POST https://example.social/api/v1/statuses\n{\n  "status": "Hi",\n  "visibility": "public"\n}',
    );
  });

  it("puts the time into the River's limit and a server's wait", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    const at = new Date("2026-10-27T14:20:00Z");
    const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    expect(refusalText({ error: "limit", message: "x", retryAt: at.toISOString() }, now)).toBe(
      `You've sent a lot from the River in the last hour. Try again after ${time}.`,
    );
    expect(refusalText({ error: "rate_limited", message: "example.social asks you to wait.", retryAt: at.toISOString() }, now)).toBe(
      `example.social asks you to wait until ${time}.`,
    );
    expect(refusalText({ error: "rejected", message: "example.social says: no", retryAt: null }, now)).toBe("example.social says: no");
  });
});
