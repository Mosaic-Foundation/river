// A hub followed two ways (civic-hub docs/FEDIVERSE.md "Following a hub both ways"; repeats.ts),
// against the local database as river_app. A member follows a hub directly and the hub's own
// fediverse account; the account's posts are the hub's items again, so the feed shows each item
// once, on the hub's card. DERIVED: the recorded hubs don't post to the fediverse yet, so the hub
// and its account are test spaces and the posts are built here the way the contract describes
// them, then mapped by the real fediverse adapter.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forAccount, type RiverDb } from "../../../src/db/context.js";
import type { Viewer } from "../../../src/river/accounts.js";
import { mapActivity as mapFediverse } from "../../../src/river/adapters/fediverse/index.js";
import { memberView } from "../../../src/river/feed/member.js";
import { queryFeed } from "../../../src/river/feed/query.js";
import { storeItems } from "../../../src/river/feed/store.js";
import type { SpaceRow } from "../../../src/river/feed/spaces.js";
import { scopeFor } from "../../../src/river/feed/visitor.js";
import { AS_PUBLIC } from "../../../src/river/adapters/civicHub/index.js";
import type { NormalizedItem } from "../../../src/shared/items/index.js";
import { createHubSpace } from "./feedHelpers.js";
import { RIVER_URL, SEED_INSTANCE, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);
const T0 = new Date("2026-11-10T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  await requireDatabase(river, "river_app");
});

afterAll(async () => {
  await river.end();
});

interface Hub {
  host: string;
  hub: SpaceRow;
  account: SpaceRow;
  actor: string;
  handle: string;
}

/** A hub of its own host, its fediverse account, and civic.json's link between them. */
async function hubWithAccount(): Promise<Hub> {
  const host = `hub-${randomUUID().slice(0, 8)}.example`;
  const actor = `https://${host}/ap/hub`;
  const handle = `@${host.split(".")[0]}@${host}`;
  const hub = await createHubSpace(river, `https://${host}/events`, {
    canonical_url: `https://${host}`,
    name: `Hub ${host}`,
    manifest: JSON.stringify({ spaceId: "s", fediverse: { actor, handle } }),
  });
  const account = await createHubSpace(river, `https://${host}/ap/hub/outbox`, {
    adapter: "fediverse",
    canonical_url: actor,
    actor_id: actor,
    category: "organization",
    name: handle,
  });
  return { host, hub, account, actor, handle };
}

/** Someone else's fediverse account. */
async function otherAccount(): Promise<SpaceRow> {
  const actor = `https://mastodon-${randomUUID().slice(0, 8)}.example/users/someone`;
  return createHubSpace(river, `${actor}/outbox`, { adapter: "fediverse", canonical_url: actor, actor_id: actor, category: "person", name: "Someone" });
}

const process = (h: Hub, id: string) => `https://${h.host}/process/${id}`;
const activity = (h: Hub, id: string) => `https://${h.host}/activities/${id}`;

/** A civic activity as the hub adapter stores it. */
function hubItem(h: Hub, eventId: string, processId: string, at: Date, title: string): NormalizedItem {
  return {
    sourceId: activity(h, eventId),
    kind: "civic",
    publishedAt: at,
    title,
    url: process(h, processId),
    streamKey: process(h, processId),
    media: [],
    civic: { activityType: "Create", objectType: "civic:Process", processIri: process(h, processId) },
    isFinalResult: false,
    hidden: false,
    raw: { id: activity(h, eventId) },
  };
}

/** The hub account's post for one item: a Create of a Note (contract step 2). */
function hubPost(h: Hub, noteId: string, at: Date, about?: { eventId?: string; processId: string }): NormalizedItem {
  const url: unknown[] = [{ type: "Link", mediaType: "text/html", href: about ? process(h, about.processId) : `https://${h.host}/fediverse/roundups/${noteId}` }];
  if (about?.eventId) url.push({ type: "Link", mediaType: "application/activity+json", rel: "alternate", href: activity(h, about.eventId) });
  const note = {
    id: `https://${h.host}/ap/notes/${noteId}`,
    type: "Note",
    attributedTo: h.actor,
    to: [AS_PUBLIC],
    published: at.toISOString(),
    content: `<p>Post ${noteId}</p>`,
    url,
    ...(about ? { context: process(h, about.processId) } : {}),
  };
  const create = { id: `${note.id}/activity`, type: "Create", actor: h.actor, to: [AS_PUBLIC], published: note.published, object: note };
  const item = mapFediverse(create, { now: at });
  if (!item || item.hidden) throw new Error("the fediverse adapter didn't map the post as a public item");
  return item;
}

async function newMember(): Promise<Viewer> {
  const accountId = randomUUID();
  await forAccount(SEED_INSTANCE, accountId, (db) => db.insert("accounts", { id: accountId }), river);
  return { accountId, did: null, displayName: null, sessionEpoch: 1 };
}

function as<T>(viewer: Viewer, fn: (db: RiverDb) => Promise<T>): Promise<T> {
  return forAccount(SEED_INSTANCE, viewer.accountId, fn, river);
}

async function follow(viewer: Viewer, ...spaces: SpaceRow[]): Promise<void> {
  await as(viewer, async (db) => {
    for (const space of spaces) await db.insert("follows", { space_id: space.id });
  });
}

async function store(space: SpaceRow, ...items: NormalizedItem[]): Promise<void> {
  await as(await newMember(), (db) => storeItems(db, space.id, items));
}

/** The member's Everything feed, newest first, as [space, title or text, alsoOn handle]. */
async function feed(viewer: Viewer, spaceId?: string) {
  return as(viewer, async (db) => {
    const scope = scopeFor(await memberView(db), "everything", undefined);
    const { items } = await queryFeed(db, scope, { spaceId, limit: 100 });
    return items.map((i) => ({ space: i.space.id, what: i.title ?? i.contentHtml, alsoOn: i.alsoOn?.handle ?? null }));
  });
}

describe("a hub followed directly and through its fediverse account", () => {
  it("hub copy first, then the account's post: one item, on the hub's card", async () => {
    const h = await hubWithAccount();
    const member = await newMember();
    await follow(member, h.hub, h.account);
    await store(h.hub, hubItem(h, "evt_1", "p1", T0, "Budget opened"));
    await store(h.account, hubPost(h, "n1", new Date(T0.getTime() + 5 * 60_000), { eventId: "evt_1", processId: "p1" }));

    expect(await feed(member)).toEqual([{ space: h.hub.id, what: "Budget opened", alsoOn: h.handle }]);
  });

  it("the account's post first, then the hub copy: still one item, on the hub's card", async () => {
    const h = await hubWithAccount();
    const member = await newMember();
    await follow(member, h.account, h.hub);
    await store(h.account, hubPost(h, "n1", T0, { eventId: "evt_1", processId: "p1" }));
    // Before the hub's copy arrives the post is already a repeat: the hub is followed.
    expect(await feed(member)).toEqual([]);
    await store(h.hub, hubItem(h, "evt_1", "p1", new Date(T0.getTime() - 60_000), "Budget opened"));

    expect(await feed(member)).toEqual([{ space: h.hub.id, what: "Budget opened", alsoOn: h.handle }]);
  });

  it("folds by activity id among several items of one process; a post without one by process and time", async () => {
    const h = await hubWithAccount();
    const member = await newMember();
    await follow(member, h.hub, h.account);
    await store(
      h.hub,
      hubItem(h, "evt_open", "p1", T0, "Vote opened"),
      hubItem(h, "evt_closed", "p1", new Date(T0.getTime() + 48 * HOUR), "Vote closed"),
      hubItem(h, "evt_other", "p2", new Date(T0.getTime() + 72 * HOUR), "Meeting"),
    );
    await store(
      h.account,
      hubPost(h, "n1", new Date(T0.getTime() + 49 * HOUR), { eventId: "evt_open", processId: "p1" }),
      hubPost(h, "n2", new Date(T0.getTime() + 72 * HOUR + 60_000), { processId: "p2" }),
      // A roundup: no context, nothing to fold into, hidden like every post from the account.
      hubPost(h, "roundup", new Date(T0.getTime() + 80 * HOUR)),
    );

    expect(await feed(member)).toEqual([
      { space: h.hub.id, what: "Meeting", alsoOn: h.handle },
      { space: h.hub.id, what: "Vote closed", alsoOn: null },
      { space: h.hub.id, what: "Vote opened", alsoOn: h.handle },
    ]);
  });

  it("following only the hub's account hides nothing", async () => {
    const h = await hubWithAccount();
    const member = await newMember();
    await follow(member, h.account);
    await store(h.hub, hubItem(h, "evt_1", "p1", T0, "Budget opened"));
    await store(h.account, hubPost(h, "n1", new Date(T0.getTime() + 60_000), { eventId: "evt_1", processId: "p1" }));

    expect(await feed(member)).toEqual([{ space: h.account.id, what: "<p>Post n1</p>", alsoOn: null }]);
  });

  it("other accounts' posts and boosts of hub posts are left alone", async () => {
    const h = await hubWithAccount();
    const other = await otherAccount();
    const member = await newMember();
    await follow(member, h.hub, h.account, other);
    await store(h.hub, hubItem(h, "evt_1", "p1", T0, "Budget opened"));
    const post = hubPost(h, "n1", new Date(T0.getTime() + 60_000), { eventId: "evt_1", processId: "p1" });
    await store(h.account, post);
    const boost: NormalizedItem = {
      sourceId: `${other.actor_id}/statuses/1/activity`,
      kind: "post",
      publishedAt: new Date(T0.getTime() + 2 * 60_000),
      contentHtml: "<p>Post n1</p>",
      url: process(h, "p1"),
      media: [],
      boostOf: { objectId: `https://${h.host}/ap/notes/n1`, host: h.host, url: process(h, "p1") },
      isFinalResult: false,
      hidden: false,
      raw: { id: `${other.actor_id}/statuses/1/activity`, type: "Announce" },
    };
    const own: NormalizedItem = { ...boost, sourceId: `${other.actor_id}/statuses/2/activity`, contentHtml: "<p>Go vote</p>", boostOf: undefined, publishedAt: new Date(T0.getTime() + 3 * 60_000) };
    await store(other, boost, own);

    expect(await feed(member)).toEqual([
      { space: other.id, what: "<p>Go vote</p>", alsoOn: null },
      { space: other.id, what: "<p>Post n1</p>", alsoOn: null },
      { space: h.hub.id, what: "Budget opened", alsoOn: h.handle },
    ]);
  });

  it("following single processes of the hub: only posts about them are repeats", async () => {
    const h = await hubWithAccount();
    const member = await newMember();
    await store(h.hub, hubItem(h, "evt_1", "p1", T0, "Followed process"));
    await store(h.account, hubPost(h, "n1", new Date(T0.getTime() + 60_000), { eventId: "evt_1", processId: "p1" }));
    await store(h.account, hubPost(h, "n2", new Date(T0.getTime() + 2 * 60_000), { eventId: "evt_2", processId: "p2" }));
    await as(member, async (db) => {
      const { id: streamId } = await db.insert("streams", { space_id: h.hub.id, key: process(h, "p1") });
      await db.insert("follows", { space_id: h.hub.id, stream_id: streamId });
      await db.insert("follows", { space_id: h.account.id });
    });

    expect(await feed(member)).toEqual([
      { space: h.account.id, what: "<p>Post n2</p>", alsoOn: null },
      { space: h.hub.id, what: "Followed process", alsoOn: h.handle },
    ]);
  });

  it("the account on its own (the Source filter) shows nothing when every post repeats the hub", async () => {
    const h = await hubWithAccount();
    const member = await newMember();
    await follow(member, h.hub, h.account);
    await store(h.account, hubPost(h, "n1", T0, { eventId: "evt_1", processId: "p1" }));
    expect(await feed(member, h.account.id)).toEqual([]);
  });
});
