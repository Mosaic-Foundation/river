// Mapping ActivityPub activities and Mastodon REST statuses to items (spec 4.3 "Map", ADR-003),
// on objects from the recorded seed accounts. Cases the seeds don't show (Event, Video, Audio,
// Page, other `to` spellings, hostile HTML) are DERIVED in each test from a real recorded
// activity, with only the field under test edited.
import { describe, expect, it } from "vitest";
import { mapActivity, mapObject, mapStatus, PUBLIC_IRIS } from "../../src/river/adapters/fediverse/index.js";
import { LINK_REL } from "../../src/shared/sanitize/index.js";
import { NOW, recordedJson } from "./helpers/fediverseFixtures.js";

type Json = Record<string, unknown>;
const ctx = { now: NOW, author: { name: "World Wide Web Consortium", handle: "@w3c@w3c.social" } };

const W3C_PAGE_1 = "https://w3c.social/users/w3c/outbox?page=true";
const W3C_PAGE_2 = "https://w3c.social/users/w3c/outbox?max_id=117399518988749790&page=true";
const EFF_PAGE_1 = "https://mastodon.social/users/eff/outbox?page=true";
const SWF_PAGE_1 = "https://socialwebfoundation.org/wp-json/activitypub/1.0/actors/0/outbox?page=1";
const EFF_STATUSES = "https://mastodon.social/api/v1/accounts/41055/statuses?limit=20&exclude_replies=true";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

function entries(url: string): Json[] {
  return recordedJson<{ orderedItems: Json[] }>(url).orderedItems;
}
const obj = (a: Json) => a.object as Json;
const isReply = (a: Json) => typeof a.object === "object" && obj(a).inReplyTo != null;
const attachments = (a: Json) => ((obj(a).attachment as Json[] | undefined) ?? []).filter((x) => x.type !== "Link");

/** A real public, top-level Create Note from @w3c without attachments. */
function realNote(): Json {
  const found = entries(W3C_PAGE_1).find(
    (a) => a.type === "Create" && !isReply(a) && attachments(a).length === 0 && (a.to as string[]).includes(PUBLIC),
  );
  if (!found) throw new Error("fixture has no plain note");
  return structuredClone(found);
}

/** DERIVED: the real note with its object edited. */
function derivedNote(change: (object: Json, activity: Json) => void): Json {
  const activity = realNote();
  change(obj(activity), activity);
  return activity;
}

describe("Create Note", () => {
  it("becomes a post: activity id as source id, sanitized content, the object's url, the space as author", () => {
    const activity = realNote();
    const item = mapActivity(activity, ctx);
    expect(item).toMatchObject({
      sourceId: activity.id,
      kind: "post",
      url: obj(activity).url,
      author: ctx.author,
      hidden: false,
      isFinalResult: false,
      media: [],
    });
    expect(item?.publishedAt.toISOString()).toBe(new Date(activity.published as string).toISOString());
    expect(item?.contentHtml).toBeTruthy();
    expect(item?.contentHtml).not.toMatch(/class="(?!invisible|ellipsis)/);
    expect(item?.raw).toBe(activity);
  });

  it("becomes a photo when it has attachments and all are images, with alt from name", () => {
    const activity = entries(W3C_PAGE_1).find(
      (a) => a.type === "Create" && attachments(a).length > 0 && attachments(a).every((x) => String(x.mediaType).startsWith("image/")),
    ) as Json;
    const item = mapActivity(activity, ctx);
    const first = attachments(activity)[0] as Json;
    expect(item?.kind).toBe("photo");
    expect(item?.media.length).toBe(attachments(activity).length);
    expect(item?.media[0]).toMatchObject({ type: "image", url: first.url });
    if (first.name) expect(item?.media[0]?.alt).toBe(first.name);
    if (first.width) expect(item?.media[0]?.width).toBe(first.width);
  });

  it("stays a post when an attachment is not an image (DERIVED: one image, one video)", () => {
    const item = mapActivity(
      derivedNote((o) => {
        o.attachment = [
          { type: "Document", mediaType: "image/png", url: "https://w3c.social/files/a.png", name: "A chart" },
          { type: "Document", mediaType: "video/mp4", url: "https://w3c.social/files/b.mp4", name: "A clip" },
        ];
      }),
      ctx,
    );
    expect(item?.kind).toBe("post");
    expect(item?.media.map((m) => m.type)).toEqual(["image", "video"]);
  });

  it("ignores Link attachments (link previews) for kind and media (real @eff post)", () => {
    const activity = entries(EFF_PAGE_1).find(
      (a) => a.type === "Create" && ((obj(a).attachment as Json[]) ?? []).some((x) => x.type === "Link"),
    ) as Json;
    const item = mapActivity(activity, ctx);
    expect(item?.kind).toBe("post");
    expect(item?.media).toEqual([]);
  });

  it("drops attachments whose URL isn't https (DERIVED)", () => {
    const item = mapActivity(
      derivedNote((o) => {
        o.attachment = [{ type: "Image", mediaType: "image/png", url: "javascript:alert(1)" }];
      }),
      ctx,
    );
    expect(item?.media).toEqual([]);
  });
});

describe("audience and replies", () => {
  it.each([...PUBLIC_IRIS])("shows an activity addressed to %s (DERIVED)", (spelling) => {
    const item = mapActivity(derivedNote((_o, a) => (a.to = [spelling])), ctx);
    expect(item?.hidden).toBe(false);
  });

  it("hides an activity not addressed to the public (DERIVED: followers only, public in cc)", () => {
    const item = mapActivity(
      derivedNote((_o, a) => {
        a.to = ["https://w3c.social/users/w3c/followers"];
        a.cc = [PUBLIC];
      }),
      ctx,
    );
    expect(item?.hidden).toBe(true);
  });

  it("hides the recorded unlisted posts (public only in cc)", () => {
    const unlisted = [...entries(W3C_PAGE_2), ...entries("https://wikis.world/users/wikipedia/outbox?page=true")].filter(
      (a) => a.type === "Create" && !(a.to as string[]).includes(PUBLIC),
    );
    expect(unlisted.length).toBeGreaterThan(0);
    for (const a of unlisted) expect(mapActivity(a, ctx)?.hidden).toBe(true);
  });

  it("hides every recorded reply", () => {
    const replies = [...entries(W3C_PAGE_2), ...entries(EFF_PAGE_1)].filter((a) => a.type === "Create" && isReply(a));
    expect(replies.length).toBeGreaterThan(0);
    for (const a of replies) expect(mapActivity(a, ctx)?.hidden).toBe(true);
  });
});

describe("other object types (DERIVED from a real note)", () => {
  it.each([
    ["Article", "article"],
    ["Page", "article"],
    ["Video", "video"],
    ["Audio", "podcast"],
    ["Event", "event"],
  ])("Create %s becomes %s, with its name as a plain-text title", (type, kind) => {
    const item = mapActivity(
      derivedNote((o) => {
        o.type = type;
        o.name = "Web <b>standards</b> &amp; you";
        o.summary = "<p>A <em>short</em> summary</p>";
      }),
      ctx,
    );
    expect(item).toMatchObject({ kind, title: "Web standards & you", summary: "A short summary", hidden: false });
  });

  it("takes a Video's file and duration from its url list (PeerTube shape)", () => {
    const item = mapActivity(
      derivedNote((o) => {
        o.type = "Video";
        o.duration = "PT2M5S";
        o.url = [
          { type: "Link", mediaType: "text/html", href: "https://w3c.social/w/abc" },
          { type: "Link", mediaType: "video/mp4", href: "https://w3c.social/static/abc-720.mp4" },
        ];
      }),
      ctx,
    );
    expect(item?.url).toBe("https://w3c.social/w/abc");
    expect(item?.media).toEqual([{ type: "video", url: "https://w3c.social/static/abc-720.mp4", duration: 125 }]);
  });

  it("M12: a PeerTube Video's duration (PT4M33S), widest icon as thumbnail, HLS file, Markdown as text", () => {
    const item = mapActivity(
      derivedNote((o) => {
        o.type = "Video";
        o.name = "Ridge";
        o.duration = "PT4M33S";
        o.mediaType = "text/markdown";
        o.content = "Line one <script>alert(1)</script>\n\n**two**";
        o.icon = [
          { type: "Image", url: "https://w3c.social/thumbs/a-small.jpg", mediaType: "image/jpeg", width: 280, height: 157 },
          { type: "Image", url: "https://w3c.social/thumbs/a-large.jpg", mediaType: "image/jpeg", width: 850, height: 480 },
          { type: "Image", url: "http://w3c.social/thumbs/insecure.jpg", mediaType: "image/jpeg", width: 1920, height: 1080 },
        ];
        o.url = [
          { type: "Link", mediaType: "text/html", href: "https://w3c.social/w/abc" },
          {
            type: "Link",
            mediaType: "application/x-mpegURL",
            href: "https://w3c.social/hls/master.m3u8",
            tag: [{ type: "Link", mediaType: "video/mp4", href: "https://w3c.social/hls/abc-720-fragmented.mp4", height: 720 }],
          },
        ];
      }),
      ctx,
    );
    expect(item).toMatchObject({ kind: "video", title: "Ridge", url: "https://w3c.social/w/abc" });
    expect(item?.media).toEqual([
      { type: "video", url: "https://w3c.social/hls/abc-720-fragmented.mp4", duration: 273 },
      { type: "image", url: "https://w3c.social/thumbs/a-large.jpg", width: 850, height: 480 },
    ]);
    expect(item?.contentHtml).toBe("<p>Line one &lt;script&gt;alert(1)&lt;/script&gt;</p><p>**two**</p>");
  });

  it("M12: a Video with a duration but no file keeps the duration on its watch page", () => {
    const item = mapActivity(
      derivedNote((o) => {
        o.type = "Video";
        o.duration = "PT1H2M3S";
        o.url = [{ type: "Link", mediaType: "text/html", href: "https://w3c.social/w/xyz" }];
      }),
      ctx,
    );
    expect(item?.media).toEqual([{ type: "video", url: "https://w3c.social/w/xyz", duration: 3723 }]);
  });

  it("keeps an Update hidden (it marks the place in the outbox but isn't a new post)", () => {
    const update = entries(SWF_PAGE_1).find((a) => a.type === "Update") as Json;
    const item = mapActivity(update, ctx);
    expect(item).toMatchObject({ sourceId: update.id, kind: "article", hidden: true });
  });

  it("maps a real WordPress Create Article to an article with its title", () => {
    const create = entries(SWF_PAGE_1).find((a) => a.type === "Create" && obj(a).type === "Article") as Json;
    const item = mapActivity(create, ctx);
    expect(item).toMatchObject({ kind: "article", title: obj(create).name, hidden: false });
  });
});

describe("check 22: hostile HTML (DERIVED: real @eff content plus script, onerror, javascript:)", () => {
  it("drops them and keeps Mastodon's invisible and ellipsis spans", () => {
    const real = entries(EFF_PAGE_1).find(
      (a) => a.type === "Create" && String(obj(a).content).includes('class="invisible"'),
    ) as Json;
    const activity = structuredClone(real);
    obj(activity).content =
      `${String(obj(activity).content)}<script>alert(1)</script>` +
      '<img src="x" onerror="alert(2)"><a href="javascript:alert(3)">click</a>';
    obj(activity).name = undefined;
    const item = mapActivity(activity, ctx);
    expect(item?.contentHtml).not.toMatch(/<script|alert|onerror|javascript:|<img/i);
    expect(item?.contentHtml).toContain('<span class="invisible">');
    expect(item?.contentHtml).toContain('<span class="ellipsis">');
    expect(item?.contentHtml).toContain(`rel="${LINK_REL}"`);
    expect(item?.contentHtml).not.toContain('target="_blank"');
  });
});

describe("Announce", () => {
  it("becomes a boost card from what the Announce carries, without the object (real @w3c boost)", () => {
    const announce = entries(W3C_PAGE_1).find((a) => a.type === "Announce" && typeof a.object === "string") as Json;
    const item = mapActivity(announce, ctx);
    const objectId = announce.object as string;
    expect(item).toMatchObject({
      sourceId: announce.id,
      kind: "post",
      hidden: false,
      url: objectId,
      author: ctx.author,
      boostOf: { objectId, host: new URL(objectId).host },
    });
    expect(item?.contentHtml).toBeUndefined();
  });

  it("uses an embedded Create's object (a WordPress Group relaying a post)", () => {
    const announce = entries(SWF_PAGE_1).find(
      (a) => a.type === "Announce" && typeof a.object === "object" && obj(a).type === "Create" && !isReply(obj(a)),
    ) as Json;
    const inner = obj(obj(announce));
    const item = mapActivity(announce, ctx);
    expect(item?.boostOf).toMatchObject({ objectId: inner.id, host: new URL(inner.id as string).host });
    expect(item?.contentHtml).toBeTruthy();
    expect(item?.hidden).toBe(false);
  });

  it("hides a relayed reply (a Group announces every reply in its threads)", () => {
    const announce = entries(SWF_PAGE_1).find(
      (a) => a.type === "Announce" && typeof a.object === "object" && isReply(obj(a)),
    ) as Json;
    expect(mapActivity(announce, ctx)?.hidden).toBe(true);
  });
});

describe("mapObject (a dereferenced boost)", () => {
  it("keys the item by the object's own id", () => {
    const object = obj(realNote());
    expect(mapObject(object, { now: NOW })).toMatchObject({ sourceId: object.id, kind: "post", hidden: false });
  });

  it("refuses non-post objects", () => {
    expect(mapObject({ id: "https://w3c.social/users/w3c", type: "Person" }, { now: NOW })).toBeUndefined();
  });
});

describe("mapStatus (Mastodon REST fallback, real @eff statuses)", () => {
  const statuses = recordedJson<Json[]>(EFF_STATUSES);

  it("gives a status the source id of its Create activity", () => {
    const status = statuses.find((s) => !s.reblog) as Json;
    const item = mapStatus(status, "mastodon.social", { now: NOW });
    expect(item?.sourceId).toBe(`${String(status.uri)}/activity`);
    expect(item?.author?.handle).toBe("@eff@mastodon.social");
    expect(item?.url).toBe(status.url);
  });

  it("maps a reblog to a boost keyed by its Announce id", () => {
    const status = statuses.find((s) => s.reblog) as Json;
    const reblog = status.reblog as Json;
    const item = mapStatus(status, "mastodon.social", { now: NOW });
    expect(item?.sourceId).toBe(status.uri);
    expect(item?.boostOf).toMatchObject({ objectId: reblog.uri, host: new URL(reblog.uri as string).host });
  });

  it("hides self-replies (exclude_replies keeps them) and non-public statuses (DERIVED)", () => {
    const reply = statuses.find((s) => s.in_reply_to_id);
    if (reply) expect(mapStatus(reply, "mastodon.social", { now: NOW })?.hidden).toBe(true);
    const unlisted = { ...(statuses.find((s) => !s.reblog && !s.in_reply_to_id) as Json), visibility: "unlisted" };
    expect(mapStatus(unlisted, "mastodon.social", { now: NOW })?.hidden).toBe(true);
  });

  it("maps image attachments to a photo with alt from the description (DERIVED)", () => {
    const status = {
      ...(statuses.find((s) => !s.reblog && !s.in_reply_to_id) as Json),
      media_attachments: [
        {
          type: "image",
          url: "https://files.mastodon.social/a.png",
          description: "A <b>chart</b>",
          meta: { original: { width: 800, height: 600 } },
        },
      ],
    };
    expect(mapStatus(status, "mastodon.social", { now: NOW })).toMatchObject({
      kind: "photo",
      media: [{ type: "image", url: "https://files.mastodon.social/a.png", alt: "A chart", width: 800, height: 600 }],
    });
  });
});
