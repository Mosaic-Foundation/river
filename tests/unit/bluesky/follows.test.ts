// "Import from Bluesky" (docs/spec/bluesky-1.md item 4) on recorded responses: @eff.org's follows,
// three pages of app.bsky.graph.getFollows, replayed through the real fetch guard. Responses marked
// DERIVED are test-only variants of a recorded one (see ../helpers/).
import { describe, expect, it } from "vitest";
import {
  accountFrom,
  followsUrl,
  MAX_FOLLOW_PAGES,
  previewForAccount,
  readFollows,
  readManifest,
} from "../../../src/river/adapters/bluesky/index.js";
import { AdapterError } from "../../../src/shared/items/index.js";
import { derived, recordedFixtures, replayGuard } from "../helpers/fediverseFixtures.js";
import { BSKY_NOW } from "./helpers.js";

const EFF_DID = "did:plc:lr36xv2l64jwtnyoaqem6z2z";

/** A well-formed, distinct did:plc for a number (base-32 digits, padded to 24). */
function fakeDid(n: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let id = "";
  for (let v = n; id.length < 24; v = Math.floor(v / 32)) id = alphabet[v % 32]! + id;
  return `did:plc:${id}`;
}

function recordedPages(): Array<{ url: string; follows: Array<Record<string, unknown>>; cursor?: string }> {
  return recordedFixtures()
    .filter((f) => f.url.startsWith(followsUrl(EFF_DID)))
    .map((f) => {
      const body = JSON.parse(f.body) as { follows: Array<Record<string, unknown>>; cursor?: string };
      return { url: f.url, follows: body.follows, cursor: body.cursor };
    });
}

describe("readFollows", () => {
  it("lists every account @eff.org follows, across its pages, each once, without the ones hiding from visitors", async () => {
    const replay = replayGuard();
    const listing = await readFollows(replay.guard, "@eff.org");
    const getFollows = replay.calls.filter((c) => c.includes("app.bsky.graph.getFollows"));
    expect(getFollows[0]).toBe(`GET ${followsUrl(EFF_DID)}`);
    expect(getFollows).toHaveLength(recordedPages().length);
    expect(getFollows.length).toBeGreaterThan(1);

    const all = recordedPages().flatMap((p) => p.follows);
    const hidden = all.filter((f) => ((f.labels as Array<{ val: string }> | undefined) ?? []).some((l) => l.val === "!no-unauthenticated"));
    expect(listing.account).toMatchObject({ did: EFF_DID, handle: "eff.org" });
    expect(listing.accounts).toHaveLength(all.length - hidden.length);
    expect(listing.skipped).toBe(hidden.length);
    expect(listing.truncated).toBe(false);
    expect(new Set(listing.accounts.map((a) => a.did)).size).toBe(listing.accounts.length);
    expect(listing.accounts.every((a) => a.did.startsWith("did:") && a.name)).toBe(true);
    // getFollows' order: most recently followed first.
    expect(listing.accounts[0]?.did).toBe((all.find((f) => !hidden.includes(f)) as { did: string }).did);
  });

  it("DERIVED: stops at MAX_FOLLOW_PAGES and says the list was cut", async () => {
    const first = recordedPages().find((p) => p.url === followsUrl(EFF_DID))!;
    // Every page answers with the first page's body and a cursor, as an endless list would.
    const pages = Array.from({ length: MAX_FOLLOW_PAGES + 1 }, (_, n) =>
      derived(n === 0 ? followsUrl(EFF_DID) : followsUrl(EFF_DID, `c${n}`), {
        from: followsUrl(EFF_DID),
        body: {
          follows: first.follows.map((f, i) => ({ ...f, did: fakeDid(n * 1000 + i) })),
          cursor: `c${n + 1}`,
        },
      }),
    );
    const replay = replayGuard(pages);
    const listing = await readFollows(replay.guard, "@eff.org");
    expect(replay.calls.filter((c) => c.includes("getFollows"))).toHaveLength(MAX_FOLLOW_PAGES);
    expect(listing.truncated).toBe(true);
  });

  it("DERIVED: a later page that fails ends the list with what was read", async () => {
    const pages = recordedPages();
    const second = pages.find((p) => p.url !== followsUrl(EFF_DID) && pages.some((q) => q.cursor && p.url === followsUrl(EFF_DID, q.cursor)))!;
    const replay = replayGuard([derived(second.url, { status: 502, body: "bad gateway" })]);
    const listing = await readFollows(replay.guard, "@eff.org");
    expect(listing.accounts.length).toBeGreaterThan(0);
    expect(listing.accounts.length).toBeLessThan(recordedPages().flatMap((p) => p.follows).length);
  });

  it("DERIVED: a first page that fails is the follow box's error", async () => {
    const replay = replayGuard([derived(followsUrl(EFF_DID), { status: 429, headers: { "retry-after": "10" }, body: {} })]);
    await expect(readFollows(replay.guard, "@eff.org")).rejects.toBeInstanceOf(AdapterError);
  });

  it("refuses input that isn't a Bluesky account", async () => {
    await expect(readFollows(replayGuard().guard, "https://demosville.civic.social")).rejects.toMatchObject({ reason: "not_a_space" });
  });
});

describe("previewForAccount", () => {
  it("makes the same DID-keyed space a follow would, with the AppView's handle", () => {
    const entry = recordedPages()[0]!.follows[0]!;
    const account = accountFrom(entry)!;
    const preview = previewForAccount(account, BSKY_NOW);
    expect(preview).toMatchObject({
      adapter: "atproto",
      canonicalUrl: `at://${account.did}`,
      actorId: account.did,
      homeUrl: `https://bsky.app/profile/${account.did}`,
      network: "bluesky",
      name: account.name,
    });
    expect(readManifest(preview.manifest).actor?.id).toBe(account.did);
    if (account.handle) expect(readManifest(preview.manifest).actor?.handle).toBe(`@${account.handle}`);
  });

  it("reads handle.invalid as no handle", () => {
    expect(accountFrom({ did: EFF_DID, handle: "handle.invalid", displayName: "X" })).toEqual({ did: EFF_DID, name: "X" });
  });
});
