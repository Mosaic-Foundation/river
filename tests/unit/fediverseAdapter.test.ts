// The fediverse adapter end to end on recorded responses from the seed accounts (spec 4.3),
// replayed through the real fetch guard: acceptance check 15 (adapter part), paging, the REST
// fallback, server-only spaces, guard refusals, 429 and boost dereferencing. No network.
// Responses marked DERIVED are test-only variants of a recorded one (see helpers/).
import { describe, expect, it } from "vitest";
import {
  ACTOR_TTL_MS,
  BOOST_DEREFERENCE_LIMIT,
  createBoostBudget,
  dereferenceBoost,
  fediverseAdapter,
  RATE_LIMITED_MESSAGE,
  readManifest,
  SERVER_ONLY_MESSAGE,
} from "../../src/river/adapters/fediverse/index.js";
import {
  AdapterError,
  type FetchContext,
  type NormalizedItem,
  type SpacePreview,
  type SpaceRecord,
} from "../../src/shared/items/index.js";
import { MockAgent } from "undici";
import { createFetchGuard, type Resolver } from "../../src/shared/fetch/index.js";
import { derived, NOW, recordedJson, replayGuard, type ReplayGuard } from "./helpers/fediverseFixtures.js";

type Json = Record<string, unknown>;

const W3C_ACTOR = "https://w3c.social/users/w3c";
const W3C_OUTBOX = "https://w3c.social/users/w3c/outbox";
const W3C_PAGE_1 = "https://w3c.social/users/w3c/outbox?page=true";
const W3C_PAGE_2 = "https://w3c.social/users/w3c/outbox?max_id=117399518988749790&page=true";
const EFF_OUTBOX = "https://mastodon.social/users/eff/outbox";
const EFF_PAGE_1 = "https://mastodon.social/users/eff/outbox?page=true";
const EFF_STATUSES = "https://mastodon.social/api/v1/accounts/41055/statuses?limit=20&exclude_replies=true";
const SWF_ACTOR = "https://socialwebfoundation.org/@swf";
const SWF_OUTBOX = "https://socialwebfoundation.org/wp-json/activitypub/1.0/actors/0/outbox";

const SEEDS = [
  "@w3c@w3c.social",
  "@wearenew_public@mastodon.social",
  "@eff@mastodon.social",
  "@internetarchive@mastodon.archive.org",
  "@wikipedia@wikis.world",
  "@swf@socialwebfoundation.org",
];

function spaceFrom(preview: SpacePreview, extra: Partial<SpaceRecord> = {}): SpaceRecord {
  return {
    id: "space-1",
    adapter: "fediverse",
    canonicalUrl: preview.canonicalUrl,
    feedUrl: preview.feedUrl ?? null,
    actorId: preview.actorId ?? null,
    network: preview.network ?? null,
    manifest: preview.manifest,
    ...extra,
  };
}

async function follow(handle: string, replay: ReplayGuard = replayGuard()) {
  const preview = await fediverseAdapter.resolve(handle, { guard: replay.guard, now: NOW });
  return { preview, space: spaceFrom(preview), replay };
}

async function rejection(promise: Promise<unknown>): Promise<AdapterError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AdapterError) return err;
    throw err;
  }
  throw new Error("expected an AdapterError");
}

function orderedItems(url: string): Json[] {
  return recordedJson<{ orderedItems: Json[] }>(url).orderedItems;
}

describe("check 15 (adapter part): following @w3c@w3c.social", () => {
  it("previews name and avatar from WebFinger, the actor and NodeInfo", async () => {
    const { preview, replay } = await follow("@w3c@w3c.social");
    const actor = recordedJson(W3C_ACTOR);
    expect(preview).toMatchObject({
      adapter: "fediverse",
      canonicalUrl: W3C_ACTOR,
      actorId: W3C_ACTOR,
      name: "World Wide Web Consortium",
      iconUrl: (actor.icon as Json).url,
      homeUrl: "https://w3c.social/@w3c",
      feedUrl: W3C_OUTBOX,
      network: "mastodon",
      category: "person",
    });
    expect(replay.calls).toEqual([
      "GET https://w3c.social/.well-known/webfinger?resource=acct:w3c@w3c.social",
      "GET https://w3c.social/users/w3c",
      "GET https://w3c.social/.well-known/nodeinfo",
      "GET https://w3c.social/nodeinfo/2.0",
    ]);
  });

  it("caches the actor in the manifest for 24 hours", async () => {
    const { preview } = await follow("@w3c@w3c.social");
    const manifest = readManifest(preview.manifest);
    expect(manifest.via).toBe("activitypub");
    expect(manifest.software?.name).toBe("mastodon");
    expect(manifest.actor).toMatchObject({ id: W3C_ACTOR, handle: "@w3c@w3c.social", outbox: W3C_OUTBOX });
    expect(Date.parse(manifest.actor?.expiresAt ?? "")).toBe(NOW.getTime() + ACTOR_TTL_MS);
  });

  it("confirming shows its posts, boosts as boost cards and replies hidden", async () => {
    const { space, replay } = await follow("@w3c@w3c.social");
    const result = await fediverseAdapter.fetchNew(space, { guard: replay.guard, now: NOW });
    const visible = result.items.filter((i) => !i.hidden);
    const boosts = visible.filter((i) => i.boostOf);
    expect(result.space.fetchStatus).toBe("ok");
    expect(visible.filter((i) => !i.boostOf).length).toBeGreaterThan(0);
    expect(boosts.length).toBeGreaterThan(0);
    for (const b of boosts) expect(b.boostOf?.host).toBeTruthy();
    // Every reply in the recorded pages is stored hidden, and none is visible.
    const replyIds = [...orderedItems(W3C_PAGE_1), ...orderedItems(W3C_PAGE_2)]
      .filter((a) => a.type === "Create" && (a.object as Json).inReplyTo)
      .map((a) => a.id);
    expect(replyIds.length).toBeGreaterThan(0);
    for (const id of replyIds) expect(result.items.find((i) => i.sourceId === id)?.hidden).toBe(true);
    expect(result.space.newestItemAt).toEqual(
      new Date(Math.max(...visible.map((i) => i.publishedAt.getTime()))),
    );
  });

  it("also resolves from the profile URL", async () => {
    const replay = replayGuard([derived("https://w3c.social/@w3c", { from: W3C_ACTOR })]);
    const preview = await fediverseAdapter.resolve("https://w3c.social/@w3c", { guard: replay.guard, now: NOW });
    expect(preview.canonicalUrl).toBe(W3C_ACTOR);
  });
});

describe("every seed account resolves and reads", () => {
  it.each(SEEDS)("%s", async (handle) => {
    const { preview, space, replay } = await follow(handle);
    expect(preview.name).toBeTruthy();
    expect(preview.iconUrl).toMatch(/^https:\/\//);
    const result = await fediverseAdapter.fetchNew(space, { guard: replay.guard, now: NOW });
    expect(result.space.fetchStatus).toBe("ok");
    expect(result.items.filter((i) => !i.hidden).length).toBeGreaterThan(0);
    for (const item of result.items) expect(item.sourceId).toMatch(/^https:\/\//);
    expect(replay.calls.some((c) => c.includes("min_id"))).toBe(false);
  });

  it("reads mastodon.social profiles through the REST lookup (unsigned actor reads get 401)", async () => {
    const { preview, replay } = await follow("@eff@mastodon.social");
    expect(replay.calls).toContain("GET https://mastodon.social/api/v1/accounts/lookup?acct=eff");
    expect(preview).toMatchObject({
      canonicalUrl: "https://mastodon.social/users/eff",
      name: "Electronic Frontier Foundation",
      feedUrl: EFF_OUTBOX,
      network: "mastodon",
    });
    expect(readManifest(preview.manifest)).toMatchObject({ via: "mastodon_api", mastodonAccountId: "41055" });
  });

  it("maps the WordPress Group to an organization", async () => {
    const { preview } = await follow("@swf@socialwebfoundation.org");
    expect(preview).toMatchObject({ category: "organization", network: "wordpress", feedUrl: SWF_OUTBOX });
  });
});

describe("fetchNew paging", () => {
  it("reads at most 2 pages and calls onPage once per page", async () => {
    const { space, replay } = await follow("@w3c@w3c.social");
    replay.calls.length = 0;
    const pages: NormalizedItem[][] = [];
    const result = await fediverseAdapter.fetchNew(space, {
      guard: replay.guard,
      now: NOW,
      isKnown: () => false,
      onPage: (items) => void pages.push(items),
    });
    expect(replay.calls).toEqual([`GET ${W3C_OUTBOX}`, `GET ${W3C_PAGE_1}`, `GET ${W3C_PAGE_2}`]);
    expect(pages.map((p) => p.length)).toEqual([orderedItems(W3C_PAGE_1).length, orderedItems(W3C_PAGE_2).length]);
    expect(result.items).toEqual(pages.flat());
  });

  it("stops at the first already-known source id", async () => {
    const { space, replay } = await follow("@w3c@w3c.social");
    replay.calls.length = 0;
    const known = orderedItems(W3C_PAGE_1)[4]?.id as string;
    const pages: NormalizedItem[][] = [];
    const result = await fediverseAdapter.fetchNew(space, {
      guard: replay.guard,
      now: NOW,
      isKnown: async (id) => id === known,
      onPage: (items) => void pages.push(items),
    });
    expect(result.items.map((i) => i.sourceId)).toEqual(orderedItems(W3C_PAGE_1).slice(0, 4).map((a) => a.id));
    expect(pages).toHaveLength(1);
    expect(replay.calls).not.toContain(`GET ${W3C_PAGE_2}`);
  });

  it("returns nothing new when the newest item is known", async () => {
    const { space, replay } = await follow("@w3c@w3c.social");
    const result = await fediverseAdapter.fetchNew(space, { guard: replay.guard, now: NOW, isKnown: () => true });
    expect(result.items).toEqual([]);
    expect(result.space.newestItemAt).toBeUndefined();
  });

  it("follows WordPress's numbered pages (no min_id)", async () => {
    const { space, replay } = await follow("@swf@socialwebfoundation.org");
    replay.calls.length = 0;
    await fediverseAdapter.fetchNew(space, { guard: replay.guard, now: NOW });
    expect(replay.calls).toEqual([`GET ${SWF_OUTBOX}`, `GET ${SWF_OUTBOX}?page=1`, `GET ${SWF_OUTBOX}?page=2`]);
  });

  it("does not re-read a cached actor, and refreshes it once expired", async () => {
    const { space, replay } = await follow("@w3c@w3c.social");
    replay.calls.length = 0;
    const fresh = await fediverseAdapter.fetchNew(space, { guard: replay.guard, now: NOW, isKnown: () => true });
    expect(replay.calls).not.toContain(`GET ${W3C_ACTOR}`);
    expect(fresh.space.manifest).toBeUndefined();

    replay.calls.length = 0;
    const later = new Date(NOW.getTime() + ACTOR_TTL_MS + 1000);
    const expired = await fediverseAdapter.fetchNew(space, { guard: replay.guard, now: later, isKnown: () => true });
    expect(replay.calls).toContain(`GET ${W3C_ACTOR}`);
    const manifest = readManifest(expired.space.manifest ?? {});
    expect(Date.parse(manifest.actor?.expiresAt ?? "")).toBe(later.getTime() + ACTOR_TTL_MS);
  });
});

describe("fallback when the outbox refuses unsigned reads", () => {
  const refused = (status: number, url: string) =>
    derived(url, { status, from: "https://mastodon.social/users/eff", headers: { "content-type": "application/json" } });

  it("uses Mastodon's REST statuses on a Mastodon server (DERIVED 401 outbox; real statuses)", async () => {
    const replay = replayGuard([refused(401, EFF_OUTBOX)]);
    const { space } = await follow("@eff@mastodon.social", replay);
    replay.calls.length = 0;
    const pages: NormalizedItem[][] = [];
    const result = await fediverseAdapter.fetchNew(space, {
      guard: replay.guard,
      now: NOW,
      onPage: (items) => void pages.push(items),
    });
    expect(replay.calls).toEqual([`GET ${EFF_OUTBOX}`, `GET ${EFF_STATUSES}`]);
    expect(result.space.fetchStatus).toBe("ok");
    expect(result.items).toHaveLength(recordedJson<Json[]>(EFF_STATUSES).length);
    expect(pages).toEqual([result.items]);

    // The REST items carry the same source ids, kinds and visibility as the outbox's, so a space
    // that switches between the two never duplicates an item.
    const viaOutbox = await fediverseAdapter.fetchNew(space, { guard: replayGuard().guard, now: NOW });
    const byId = new Map(viaOutbox.items.map((i) => [i.sourceId, i]));
    const shared = result.items.filter((i) => byId.has(i.sourceId));
    expect(shared.length).toBeGreaterThanOrEqual(10);
    for (const item of shared) {
      expect({ kind: item.kind, hidden: item.hidden, boost: item.boostOf?.objectId }).toEqual({
        kind: byId.get(item.sourceId)?.kind,
        hidden: byId.get(item.sourceId)?.hidden,
        boost: byId.get(item.sourceId)?.boostOf?.objectId,
      });
    }
  });

  it("looks the account up first when the manifest has no Mastodon id (DERIVED 403 outbox)", async () => {
    const replay = replayGuard([refused(403, EFF_OUTBOX)]);
    const { space } = await follow("@eff@mastodon.social", replay);
    const manifest = { ...space.manifest };
    delete manifest.mastodonAccountId;
    replay.calls.length = 0;
    const result = await fediverseAdapter.fetchNew({ ...space, manifest }, { guard: replay.guard, now: NOW });
    expect(replay.calls).toEqual([
      `GET ${EFF_OUTBOX}`,
      "GET https://mastodon.social/api/v1/accounts/lookup?acct=eff",
      `GET ${EFF_STATUSES}`,
    ]);
    expect(result.items.length).toBeGreaterThan(0);
    expect(readManifest(result.space.manifest ?? {}).mastodonAccountId).toBe("41055");
  });

  it("marks a non-Mastodon space blocked with the server-only message (DERIVED 403 outbox)", async () => {
    const replay = replayGuard([refused(403, SWF_OUTBOX)]);
    const { space } = await follow("@swf@socialwebfoundation.org", replay);
    replay.calls.length = 0;
    const result = await fediverseAdapter.fetchNew(space, { guard: replay.guard, now: NOW });
    expect(result.items).toEqual([]);
    expect(result.space).toMatchObject({ fetchStatus: "blocked", lastError: SERVER_ONLY_MESSAGE });
    expect(replay.calls).toEqual([`GET ${SWF_OUTBOX}`]);
  });

  it("refuses to follow a non-Mastodon actor that needs signatures (DERIVED 401 actor)", async () => {
    const replay = replayGuard([refused(401, SWF_ACTOR)]);
    const err = await rejection(fediverseAdapter.resolve("@swf@socialwebfoundation.org", { guard: replay.guard, now: NOW }));
    expect(err.reason).toBe("server_only");
    expect(err.message).toBe(SERVER_ONLY_MESSAGE);
  });
});

describe("errors", () => {
  it("turns guard refusals into 'refused' without sending anything", async () => {
    const replay = replayGuard();
    for (const input of ["https://127.0.0.1/@admin", "@admin@10.0.0.5", "https://[::1]/users/admin"]) {
      const err = await rejection(fediverseAdapter.resolve(input, { guard: replay.guard, now: NOW }));
      expect(err.reason).toBe("refused");
      expect(err.message).toBe("This address can't be followed");
    }
    expect(replay.calls).toEqual([]);
  });

  it("refuses a host that resolves to a private address", async () => {
    const resolver: Resolver = async () => [{ address: "192.168.1.10", family: 4 }];
    const dispatcher = new MockAgent();
    dispatcher.disableNetConnect();
    const guard = createFetchGuard({ resolver, dispatcher });
    const err = await rejection(fediverseAdapter.resolve("@alice@intranet.example", { guard, now: NOW }));
    expect(err.reason).toBe("refused");
  });

  it("reports an unknown host as unreachable", async () => {
    const err = await rejection(fediverseAdapter.resolve("@alice@nowhere.example", { guard: replayGuard().guard, now: NOW }));
    expect(err).toMatchObject({ reason: "unreachable", message: "We couldn't reach that address" });
  });

  it("reports an unknown account as not a space (DERIVED 404 WebFinger)", async () => {
    const url = "https://w3c.social/.well-known/webfinger?resource=acct:nobody@w3c.social";
    const replay = replayGuard([
      derived(url, { status: 404, body: "", from: "https://w3c.social/.well-known/webfinger?resource=acct:w3c@w3c.social" }),
    ]);
    const err = await rejection(fediverseAdapter.resolve("@nobody@w3c.social", { guard: replay.guard, now: NOW }));
    expect(err.reason).toBe("not_a_space");
  });

  it("reports a 429 and never retries; the guard then waits out Retry-After (DERIVED 429 outbox)", async () => {
    const replay = replayGuard([derived(W3C_OUTBOX, { status: 429, body: "", headers: { "retry-after": "300" } })]);
    const { space } = await follow("@w3c@w3c.social", replay);
    replay.calls.length = 0;
    const ctx: FetchContext = { guard: replay.guard, now: NOW };
    const first = await rejection(fediverseAdapter.fetchNew(space, ctx));
    expect(first).toMatchObject({ reason: "unreachable", message: RATE_LIMITED_MESSAGE });
    expect(replay.calls).toEqual([`GET ${W3C_OUTBOX}`]);
    const second = await rejection(fediverseAdapter.fetchNew(space, ctx));
    expect(second.message).toBe(RATE_LIMITED_MESSAGE);
    expect(replay.calls).toHaveLength(1);
  });
});

describe("dereferenceBoost: fetched only when opened, at most 20 per refresh", () => {
  async function w3cBoost() {
    const { space, replay } = await follow("@w3c@w3c.social");
    const result = await fediverseAdapter.fetchNew(space, { guard: replay.guard, now: NOW });
    const boost = result.items.find((i) => i.boostOf?.objectId === "https://w3c.social/users/w3cdevs/statuses/117471856565477515");
    if (!boost?.boostOf) throw new Error("recorded boost missing");
    replay.calls.length = 0;
    return { boost: boost.boostOf, replay };
  }

  it("fetches no boosted object while reading the outbox", async () => {
    const { space, replay } = await follow("@w3c@w3c.social");
    replay.calls.length = 0;
    await fediverseAdapter.fetchNew(space, { guard: replay.guard, now: NOW });
    expect(replay.calls.length).toBeGreaterThan(0);
    expect(replay.calls.every((c) => c.startsWith(`GET ${W3C_OUTBOX}`))).toBe(true);
  });

  it("reads the boosted post (real recorded object) as an item keyed by its own id", async () => {
    const { boost, replay } = await w3cBoost();
    const budget = createBoostBudget();
    const result = await dereferenceBoost(boost, { guard: replay.guard, budget, now: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item).toMatchObject({ sourceId: boost.objectId, hidden: false });
      expect(result.item.contentHtml).toBeTruthy();
    }
    expect(replay.calls).toEqual([`GET ${boost.objectId}`]);
    expect(budget.remaining()).toBe(BOOST_DEREFERENCE_LIMIT - 1);
  });

  it("stops at 20 per refresh without fetching the 21st", async () => {
    const { boost, replay } = await w3cBoost();
    const budget = createBoostBudget();
    const results = [];
    for (let i = 0; i < BOOST_DEREFERENCE_LIMIT + 1; i++) {
      results.push(await dereferenceBoost(boost, { guard: replay.guard, budget, now: NOW }));
    }
    expect(results.slice(0, 20).every((r) => r.ok)).toBe(true);
    expect(results[20]).toEqual({ ok: false, reason: "budget" });
    expect(replay.calls).toHaveLength(20);
  });

  it("reports an unreadable or refused object without throwing", async () => {
    const replay = replayGuard([
      derived("https://w3c.social/users/w3cdevs/statuses/1", { status: 401, from: W3C_ACTOR, body: "" }),
    ]);
    const budget = createBoostBudget();
    expect(await dereferenceBoost("https://w3c.social/users/w3cdevs/statuses/1", { guard: replay.guard, budget })).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(await dereferenceBoost("https://10.0.0.5/notes/1", { guard: replay.guard, budget })).toEqual({
      ok: false,
      reason: "refused",
    });
    expect(await dereferenceBoost("http://w3c.social/notes/1", { guard: replay.guard, budget })).toEqual({
      ok: false,
      reason: "refused",
    });
  });

  it("refuses an object served from a host other than its id's (DERIVED)", async () => {
    const real = recordedJson("https://w3c.social/users/w3cdevs/statuses/117471856565477515");
    const url = "https://mastodon.social/users/eff/statuses/999";
    const replay = replayGuard([derived(url, { from: EFF_PAGE_1, body: real })]);
    const result = await dereferenceBoost(url, { guard: replay.guard, budget: createBoostBudget() });
    expect(result).toEqual({ ok: false, reason: "unreadable" });
  });
});
