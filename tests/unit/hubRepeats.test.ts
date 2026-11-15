// A hub followed two ways (civic-hub docs/FEDIVERSE.md "Following a hub both ways"): the hub names
// its fediverse account in civic.json, and the feed treats that account's posts as repeats when
// the reader follows the hub too. DERIVED: the recorded hubs don't serve `features.fediverse` yet
// (the hub's fediverse posting is on civic-hub's dev branch), so civic.json is the recorded
// Demosville one with the field added as the contract describes it.
import { describe, expect, it } from "vitest";
import { civicHubAdapter, CIVIC_JSON_RECHECK_MS, refreshedManifest } from "../../src/river/adapters/civicHub/index.js";
import {
  announcedActivity,
  repeatNotice,
  repeatParams,
  repeatRules,
} from "../../src/river/feed/repeats.js";
import type { SpaceRow } from "../../src/river/feed/spaces.js";
import type { ReaderFollow } from "../../src/river/feed/visitor.js";
import type { HttpFixture } from "../../src/shared/fetch/index.js";
import type { SpaceRecord } from "../../src/shared/items/index.js";
import { NOW, recorded, replayGuard } from "./civicHub/helpers.js";

const REAL = JSON.parse(recorded("https://demosville.civic.social/.well-known/civic.json").body) as Record<string, unknown>;

function civicJson(host: string, fediverse: unknown): HttpFixture {
  return {
    url: `https://${host}/.well-known/civic.json`,
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...REAL, features: { fediverse } }),
  };
}

const ACCOUNT = {
  actor: "https://athens.example/ap/hub",
  handle: "@athens@athens.example",
  outbox: "https://athens.example/ap/hub/outbox",
  repeats: "https://athens.example/events",
};

describe("civic.json names the hub's fediverse account", () => {
  it("is kept in the hub's manifest when following", async () => {
    const { guard } = replayGuard([civicJson("athens.example", ACCOUNT)]);
    const preview = await civicHubAdapter.resolve("https://athens.example", { guard, now: NOW });
    expect(preview.manifest.fediverse).toEqual({ actor: ACCOUNT.actor, handle: ACCOUNT.handle });
  });

  it("an actor on another host, or no feature, is ignored", async () => {
    const elsewhere = replayGuard([civicJson("athens.example", { ...ACCOUNT, actor: "https://mastodon.example/users/athens" })]);
    expect((await civicHubAdapter.resolve("https://athens.example", { guard: elsewhere.guard, now: NOW })).manifest.fediverse).toBeUndefined();
    const off = replayGuard([recorded("https://demosville.civic.social/.well-known/civic.json")]);
    expect((await civicHubAdapter.resolve("https://demosville.civic.social", { guard: off.guard, now: NOW })).manifest.fediverse).toBeUndefined();
  });

  it("a refresh reads civic.json again at most once a day, and a failed read changes nothing", async () => {
    const space: SpaceRecord = {
      id: "s",
      adapter: "civic_hub",
      canonicalUrl: "https://athens.example",
      feedUrl: "https://athens.example/events",
      manifest: { spaceId: "x" },
    };
    const first = replayGuard([civicJson("athens.example", ACCOUNT)]);
    const manifest = await refreshedManifest(space, { guard: first.guard, now: NOW });
    expect(manifest).toEqual({
      spaceId: "x",
      fediverse: { actor: ACCOUNT.actor, handle: ACCOUNT.handle },
      civicJsonCheckedAt: NOW.toISOString(),
    });

    const soon = replayGuard([civicJson("athens.example", ACCOUNT)]);
    const later = new Date(NOW.getTime() + CIVIC_JSON_RECHECK_MS - 1);
    expect(await refreshedManifest({ ...space, manifest: manifest! }, { guard: soon.guard, now: later })).toBeUndefined();
    expect(soon.requests).toHaveLength(0);

    // The hub turned the feature off: the account is forgotten.
    const off = replayGuard([{ ...civicJson("athens.example", ACCOUNT), body: JSON.stringify(REAL) }]);
    const dayOn = new Date(NOW.getTime() + CIVIC_JSON_RECHECK_MS);
    expect((await refreshedManifest({ ...space, manifest: manifest! }, { guard: off.guard, now: dayOn }))?.fediverse).toBeUndefined();

    const broken = replayGuard([{ ...civicJson("athens.example", ACCOUNT), status: 503, body: "" }]);
    expect(await refreshedManifest({ ...space, manifest: manifest! }, { guard: broken.guard, now: dayOn })).toBeUndefined();
  });
});

function row(id: string, extra: Partial<SpaceRow>): SpaceRow {
  return {
    id,
    adapter: "civic_hub",
    canonical_url: `https://${id}.example`,
    feed_url: null,
    actor_id: null,
    network: null,
    category: null,
    name: id,
    icon_url: null,
    home_url: null,
    manifest: {},
    etag: null,
    etag_url: null,
    newest_item_at: null,
    last_fetched_at: null,
    fetch_lock_until: null,
    fetch_status: null,
    error_count: 0,
    last_error: null,
    ...extra,
  };
}

const HUB = row("hub", { name: "Athens Civic Hub", manifest: { fediverse: { actor: ACCOUNT.actor, handle: ACCOUNT.handle } } });
const HUB_ACCOUNT = row("acct", { adapter: "fediverse", actor_id: ACCOUNT.actor });
const OTHER = row("other", { adapter: "fediverse", actor_id: "https://mastodon.example/users/someone" });
const spaces = new Map([HUB, HUB_ACCOUNT, OTHER].map((s) => [s.id, s]));

describe("repeat rules", () => {
  it("following the hub and its account: every post from the account repeats the hub", () => {
    const follows: ReaderFollow[] = [{ spaceId: "acct" }, { spaceId: "other" }, { spaceId: "hub" }];
    expect(repeatRules(follows, spaces)).toEqual([
      { spaceId: "acct", hubSpaceId: "hub", hubName: "Athens Civic Hub", handle: ACCOUNT.handle },
    ]);
  });

  it("following only the account (or only the hub) hides nothing", () => {
    expect(repeatRules([{ spaceId: "acct" }, { spaceId: "other" }], spaces)).toEqual([]);
    expect(repeatRules([{ spaceId: "hub" }], spaces)).toEqual([]);
  });

  it("following single processes of the hub: only posts about those processes repeat it", () => {
    const follows: ReaderFollow[] = [
      { spaceId: "acct" },
      { spaceId: "hub", streamKey: "https://athens.example/process/a" },
      { spaceId: "hub", streamKey: "https://athens.example/process/b" },
    ];
    const [rule] = repeatRules(follows, spaces);
    expect(rule?.contexts).toEqual(["https://athens.example/process/a", "https://athens.example/process/b"]);
    expect(repeatParams([rule!])).toEqual({
      spaceIds: ["acct", "acct"],
      contexts: ["https://athens.example/process/a", "https://athens.example/process/b"],
    });
    expect(repeatNotice(rule!)).toContain("processes you follow");
  });

  it("a hub naming an account the reader doesn't follow, or another account, makes no rule", () => {
    const follows: ReaderFollow[] = [{ spaceId: "other" }, { spaceId: "hub" }];
    expect(repeatRules(follows, spaces)).toEqual([]);
  });

  it("a whole-account rule hides every post (a null context)", () => {
    const [rule] = repeatRules([{ spaceId: "acct" }, { spaceId: "hub" }], spaces);
    expect(repeatParams([rule!])).toEqual({ spaceIds: ["acct"], contexts: [null] });
    expect(repeatNotice(rule!)).toBe(
      "Posts from @athens@athens.example repeat Athens Civic Hub, which you follow directly, so they show with the hub's own items.",
    );
  });
});

describe("the civic activity a hub post announces", () => {
  it("is the url Link with mediaType application/activity+json", () => {
    const links = [
      { type: "Link", mediaType: "text/html", href: "https://athens.example/process/a" },
      { type: "Link", mediaType: "application/activity+json", rel: "alternate", href: "https://athens.example/activities/evt_1" },
    ];
    expect(announcedActivity(links)).toBe("https://athens.example/activities/evt_1");
    expect(announcedActivity("https://athens.example/process/a")).toBeUndefined();
    expect(announcedActivity(undefined)).toBeUndefined();
  });
});
