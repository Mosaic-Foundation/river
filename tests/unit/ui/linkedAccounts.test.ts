// Settings → Linked accounts' words (ui/src/lib/linkedAccounts.ts; fediverse-posting-1.md items 1.3
// and 1.7, ADR-010 §6).
import { describe, expect, it } from "vitest";
import {
  explainer,
  linkResultMessage,
  statusNote,
  unlinkedMessage,
  type LinkedAccount,
} from "../../../ui/src/lib/linkedAccounts";

describe("linked accounts' words", () => {
  it("the explainer says what the River can and can't do, as item 1.3 does", () => {
    expect(explainer("@ana@example.social")).toEqual([
      "Mosaic River will be able to post and reply as @ana@example.social, boost, favourite, follow and unfollow, and delete posts you make from the River.",
      "It can't read your messages or change your profile. You'll see each post before it's sent. You can unlink at any time.",
    ]);
  });

  it("words every callback result, and nothing else", () => {
    for (const result of ["linked", "denied", "expired", "different_account", "too_many", "busy", "unreachable", "failed", "signed_out"]) {
      expect(linkResultMessage(result)?.text, result).toBeTruthy();
    }
    expect(linkResultMessage("linked")?.ok).toBe(true);
    expect(linkResultMessage("different_account")).toEqual({
      ok: false,
      text: "That's a different account from the one you named. Nothing was linked.",
    });
    expect(linkResultMessage("<b>x</b>")).toBeUndefined();
    expect(linkResultMessage(null)).toBeUndefined();
  });

  it("after unlinking, says to remove the app there when the server didn't confirm (ADR-010 §6)", () => {
    expect(unlinkedMessage({ handle: "@ana@example.social", server: "example.social", revokedThere: false })).toBe(
      "We've forgotten the key to @ana@example.social. To be sure, also remove Mosaic River from example.social's authorized apps.",
    );
    expect(unlinkedMessage({ handle: "@ana@example.social", server: "example.social", revokedThere: true })).toBe(
      "@ana@example.social is unlinked, and example.social has forgotten the River's key.",
    );
  });

  it("notes links that stopped working", () => {
    const account: LinkedAccount = {
      id: "a",
      handle: "@ana@example.social",
      server: "example.social",
      displayName: null,
      avatarUrl: null,
      software: "Mastodon",
      scopes: [],
      status: "revoked",
      linkedAt: "2026-10-27T12:00:00.000Z",
      lastUsedAt: null,
    };
    expect(statusNote(account)).toBe("Your link to @ana@example.social stopped working. Link it again.");
    expect(statusNote({ ...account, status: "active" })).toBeUndefined();
  });
});
