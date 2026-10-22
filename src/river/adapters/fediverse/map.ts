// ActivityPub activities and Mastodon REST statuses to items (spec 4.3 "Map", ADR-003).
//
// - Only activities whose `to` names the public collection are shown; the rest are kept hidden.
// - Replies are hidden.
// - Create Note -> post, or photo when it has at least one attachment and all are images (Link
//   attachments are link previews, not attachments in this sense); Article, Page -> article;
//   Video -> video; Audio -> podcast; Event -> event.
// - Announce -> a boost item carrying what the Announce itself carries; the boosted object is
//   never fetched here (fetchNew fills boosts afterwards, boostContent.ts).
// - HTML goes through sanitize(); titles, summaries and alt text through toPlainText().
import { sanitize, toPlainText } from "../../../shared/sanitize/index.js";
import { plainTextAsHtml } from "../text.js";
import type { BoostRef, ItemAuthor, ItemKind, MediaRef, NormalizedItem } from "../../../shared/items/index.js";
import {
  addressedToPublic,
  asList,
  dateOf,
  durationSeconds,
  hostOf,
  httpsUrl,
  idOf,
  isObject,
  num,
  str,
  typeOf,
  urlOf,
  type AsObject,
} from "./activitypub.js";

export interface MapContext {
  /** The space's actor, as the author of its own posts. */
  author?: ItemAuthor;
  /** Fallback publish time for objects without one. */
  now: Date;
}

/** Object types the River shows, and the kind each becomes. */
const OBJECT_KIND: Readonly<Record<string, ItemKind>> = {
  Note: "post",
  Question: "post",
  Article: "article",
  Page: "article",
  Video: "video",
  Audio: "podcast",
  Event: "event",
  Image: "photo",
};

/** Kinds whose `name` is a title (a Note's name, when present, is not). */
const TITLED: ReadonlySet<ItemKind> = new Set(["article", "video", "podcast", "event", "photo"]);

function mediaTypeOf(mime: string | undefined, asType: string | undefined): MediaRef["type"] | undefined {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime) return undefined;
  if (asType === "Image") return "image";
  if (asType === "Video") return "video";
  if (asType === "Audio") return "audio";
  return undefined;
}

/** Attachments other than Links (Mastodon's link previews). */
function realAttachments(object: AsObject): AsObject[] {
  return asList(object.attachment).filter(isObject).filter((a) => typeOf(a) !== "Link");
}

function mediaOf(object: AsObject, kind: ItemKind): MediaRef[] {
  const media: MediaRef[] = [];
  for (const att of realAttachments(object)) {
    const type = mediaTypeOf(str(att.mediaType), typeOf(att));
    const url = urlOf(att.url ?? att.href, type);
    if (!type || !url) continue;
    const alt = toPlainText(str(att.name));
    media.push({
      type,
      url,
      ...(alt ? { alt } : {}),
      ...(num(att.width) !== undefined ? { width: num(att.width) } : {}),
      ...(num(att.height) !== undefined ? { height: num(att.height) } : {}),
      ...(durationSeconds(att.duration) !== undefined ? { duration: durationSeconds(att.duration) } : {}),
    });
  }
  // A Video or Audio object (PeerTube, Funkwhale, Castopod) carries its file in `url`, its length
  // in `duration` and its thumbnail in `icon`.
  if (media.length === 0 && (kind === "video" || kind === "podcast")) {
    const type = kind === "video" ? "video" : "audio";
    const file = mediaFile(object, type);
    const duration = durationSeconds(object.duration);
    if (file) {
      media.push({ type, url: file, ...(duration !== undefined ? { duration } : {}) });
    } else if (duration !== undefined) {
      // PeerTube with HLS only lists no plain file at the top: the length still belongs on the
      // card, so the entry points at the watch page.
      const page = urlOf(object.url, "text/html") ?? httpsUrl(object.id);
      if (page) media.push({ type, url: page, duration });
    }
    const thumbnail = thumbnailOf(object);
    if (thumbnail) media.push(thumbnail);
  }
  return media;
}

function linkHref(link: AsObject): string | undefined {
  return httpsUrl(link.href) ?? httpsUrl(link.url);
}

/**
 * The file a Video or Audio object links to: a top-level `url` Link with a video/ or audio/ type,
 * or, when there is none, one inside a Link's `tag` (PeerTube lists its HLS files under the
 * playlist Link). Only https.
 */
function mediaFile(object: AsObject, type: "video" | "audio"): string | undefined {
  const isFile = (link: AsObject) => str(link.mediaType)?.startsWith(`${type}/`) === true && linkHref(link) !== undefined;
  const links = asList(object.url).filter(isObject);
  const top = links.find(isFile);
  if (top) return linkHref(top);
  for (const link of links) {
    const nested = asList(link.tag).filter(isObject).find(isFile);
    if (nested) return linkHref(nested);
  }
  return undefined;
}

/**
 * A Video's or Audio's thumbnail from `icon` (PeerTube lists several sizes; the widest is taken),
 * else `image`. Its alt text is the icon's own `name` when it has one; otherwise the image is
 * decorative (the card's title already says what it shows).
 */
function thumbnailOf(object: AsObject): MediaRef | undefined {
  const candidates: Array<{ url: string; name?: string; width?: number; height?: number }> = [];
  for (const entry of [...asList(object.icon), ...asList(object.image)]) {
    if (typeof entry === "string") {
      const url = httpsUrl(entry);
      if (url) candidates.push({ url });
      continue;
    }
    if (!isObject(entry)) continue;
    const mime = str(entry.mediaType);
    if (mime && !mime.startsWith("image/")) continue;
    const url = urlOf(entry.url ?? entry.href);
    if (url) candidates.push({ url, name: str(entry.name), width: num(entry.width), height: num(entry.height) });
  }
  if (candidates.length === 0) return undefined;
  const best = candidates.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a));
  const alt = toPlainText(best.name);
  return {
    type: "image",
    url: best.url,
    ...(alt ? { alt } : {}),
    ...(best.width !== undefined ? { width: best.width } : {}),
    ...(best.height !== undefined ? { height: best.height } : {}),
  };
}

function kindOf(object: AsObject): ItemKind | undefined {
  const kind = OBJECT_KIND[typeOf(object) ?? ""];
  if (kind !== "post") return kind;
  const attachments = realAttachments(object);
  const allImages =
    attachments.length > 0 &&
    attachments.every((a) => mediaTypeOf(str(a.mediaType), typeOf(a)) === "image");
  return allImages ? "photo" : "post";
}

function contentOf(object: AsObject): string | undefined {
  const content = str(object.content) ?? str(Object.values(isObject(object.contentMap) ? object.contentMap : {})[0]);
  // PeerTube sends a video's description as Markdown (mediaType text/markdown): it is shown as
  // text in paragraphs, never parsed as HTML.
  const markdown = str(object.mediaType) === "text/markdown";
  const clean = sanitize(markdown && content !== undefined ? plainTextAsHtml(content) : content);
  return clean === "" ? undefined : clean;
}

function plain(value: unknown): string | undefined {
  const text = toPlainText(str(value));
  return text === "" ? undefined : text;
}

function isReply(object: unknown): boolean {
  return isObject(object) && idOf(object.inReplyTo) !== undefined;
}

/** The item fields that come from the object itself (kind, text, media, url). */
function objectFields(object: AsObject): Pick<NormalizedItem, "kind" | "title" | "summary" | "contentHtml" | "url" | "media"> & {
  known: boolean;
} {
  const kind = kindOf(object);
  const k = kind ?? "post";
  return {
    known: kind !== undefined,
    kind: k,
    title: TITLED.has(k) ? plain(object.name) : undefined,
    summary: plain(object.summary),
    contentHtml: contentOf(object),
    url: urlOf(object.url, "text/html") ?? httpsUrl(object.id),
    media: mediaOf(object, k),
  };
}

function withoutUndefined(item: NormalizedItem): NormalizedItem {
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)) as unknown as NormalizedItem;
}

/** An Announce: a boost card, from what the Announce carries (spec 4.3). */
function mapAnnounce(activity: AsObject, sourceId: string, ctx: MapContext): NormalizedItem | undefined {
  let target: unknown = activity.object;
  // A Group relaying a post (FEP-1b12, WordPress, Lemmy) announces the Create, not the object.
  if (isObject(target) && ["Create", "Update"].includes(typeOf(target) ?? "")) target = target.object;
  const objectId = idOf(target);
  const host = hostOf(objectId);
  const published = dateOf(activity.published) ?? ctx.now;
  if (!objectId || !host) {
    return withoutUndefined({
      sourceId, kind: "post", publishedAt: published, author: ctx.author, media: [],
      isFinalResult: false, hidden: true, raw: activity,
    });
  }
  const embedded = isObject(target) ? target : undefined;
  const fields = embedded ? objectFields(embedded) : undefined;
  const boostedAuthor = embedded ? idOf(embedded.attributedTo) : undefined;
  const boostOf: BoostRef = {
    objectId,
    host,
    ...(fields?.url ? { url: fields.url } : {}),
    ...(boostedAuthor ? { author: { url: boostedAuthor } } : {}),
  };
  return withoutUndefined({
    sourceId,
    kind: fields?.kind ?? "post",
    publishedAt: published,
    title: fields?.title,
    summary: fields?.summary,
    contentHtml: fields?.contentHtml,
    url: fields?.url ?? httpsUrl(objectId),
    author: ctx.author,
    media: fields?.media ?? [],
    boostOf,
    isFinalResult: false,
    // A Group relaying a whole thread announces every reply in it; those stay hidden too.
    hidden: !addressedToPublic(activity.to) || isReply(embedded),
    raw: activity,
  });
}

/**
 * One outbox entry to an item. Create, Announce and bare objects are mapped; anything else with
 * an id (Update, Delete, Like...) is kept hidden, so it still marks where the last fetch stopped.
 * Returns undefined for entries without an id.
 */
export function mapActivity(entry: unknown, ctx: MapContext): NormalizedItem | undefined {
  if (!isObject(entry)) return undefined;
  const sourceId = httpsUrl(entry.id);
  if (!sourceId) return undefined;
  const type = typeOf(entry) ?? "";
  if (type === "Announce") return mapAnnounce(entry, sourceId, ctx);

  const isCreate = type === "Create";
  const object = isCreate ? entry.object : OBJECT_KIND[type] ? entry : isObject(entry.object) ? entry.object : undefined;
  const published = dateOf(entry.published) ?? (isObject(object) ? dateOf(object.published) : undefined) ?? ctx.now;
  if (!isObject(object)) {
    return withoutUndefined({
      sourceId, kind: "post", publishedAt: published, author: ctx.author, media: [],
      isFinalResult: false, hidden: true, raw: entry,
    });
  }
  const fields = objectFields(object);
  const shown = (isCreate || OBJECT_KIND[type] !== undefined) && fields.known;
  return withoutUndefined({
    sourceId,
    kind: fields.kind,
    publishedAt: published,
    title: fields.title,
    summary: fields.summary,
    contentHtml: fields.contentHtml,
    url: fields.url,
    author: ctx.author,
    media: fields.media,
    isFinalResult: false,
    hidden: !shown || !addressedToPublic(entry.to) || isReply(object),
    raw: entry,
  });
}

/** A dereferenced object (a boosted post) to an item keyed by the object's own id. */
export function mapObject(object: unknown, ctx: MapContext): NormalizedItem | undefined {
  if (!isObject(object)) return undefined;
  const sourceId = httpsUrl(object.id);
  if (!sourceId || OBJECT_KIND[typeOf(object) ?? ""] === undefined) return undefined;
  const fields = objectFields(object);
  const attributedTo = idOf(object.attributedTo);
  return withoutUndefined({
    sourceId,
    kind: fields.kind,
    publishedAt: dateOf(object.published) ?? ctx.now,
    title: fields.title,
    summary: fields.summary,
    contentHtml: fields.contentHtml,
    url: fields.url,
    author: attributedTo ? { url: attributedTo } : undefined,
    media: fields.media,
    isFinalResult: false,
    hidden: !addressedToPublic(object.to) || isReply(object),
    raw: object,
  });
}

// --- Mastodon REST (spec 4.3 fallback) ---

function restMedia(status: AsObject): MediaRef[] {
  const media: MediaRef[] = [];
  for (const att of asList(status.media_attachments).filter(isObject)) {
    const kind = str(att.type);
    const type: MediaRef["type"] | undefined =
      kind === "image" ? "image" : kind === "video" || kind === "gifv" ? "video" : kind === "audio" ? "audio" : undefined;
    const url = httpsUrl(att.url) ?? httpsUrl(att.remote_url);
    if (!type || !url) continue;
    const original = isObject(att.meta) && isObject(att.meta.original) ? att.meta.original : {};
    const alt = toPlainText(str(att.description));
    media.push({
      type,
      url,
      ...(alt ? { alt } : {}),
      ...(num(original.width) !== undefined ? { width: num(original.width) } : {}),
      ...(num(original.height) !== undefined ? { height: num(original.height) } : {}),
      ...(num(original.duration) !== undefined ? { duration: num(original.duration) } : {}),
    });
  }
  return media;
}

function restKind(status: AsObject): ItemKind {
  const attachments = asList(status.media_attachments).filter(isObject);
  return attachments.length > 0 && attachments.every((a) => a.type === "image") ? "photo" : "post";
}

function restAuthor(account: unknown, host: string): ItemAuthor | undefined {
  if (!isObject(account)) return undefined;
  const acct = str(account.acct);
  return {
    name: str(account.display_name) ?? str(account.username),
    handle: acct ? `@${acct.includes("@") ? acct : `${acct}@${host}`}` : undefined,
    url: httpsUrl(account.url),
    iconUrl: httpsUrl(account.avatar),
  };
}

/**
 * A Mastodon REST status to the same item its outbox activity would give. Source ids match the
 * outbox: a status's Create is `{uri}/activity`, and a reblog's own `uri` is its Announce's id.
 */
export function mapStatus(status: unknown, host: string, ctx: MapContext): NormalizedItem | undefined {
  if (!isObject(status)) return undefined;
  const uri = httpsUrl(status.uri);
  if (!uri) return undefined;
  const published = dateOf(status.created_at) ?? ctx.now;
  const reblog = isObject(status.reblog) ? status.reblog : undefined;
  const isPublic = status.visibility === "public";

  if (reblog) {
    const objectId = httpsUrl(reblog.uri);
    const objectHost = hostOf(objectId);
    if (!objectId || !objectHost) return undefined;
    const author = restAuthor(reblog.account, objectHost);
    const url = httpsUrl(reblog.url) ?? objectId;
    return withoutUndefined({
      sourceId: uri,
      kind: restKind(reblog),
      publishedAt: published,
      summary: plain(reblog.spoiler_text),
      contentHtml: sanitize(str(reblog.content)) || undefined,
      url,
      author: ctx.author,
      media: restMedia(reblog),
      boostOf: { objectId, host: objectHost, url, ...(author ? { author } : {}) },
      isFinalResult: false,
      hidden: !isPublic,
      raw: status,
    });
  }

  return withoutUndefined({
    sourceId: `${uri}/activity`,
    kind: restKind(status),
    publishedAt: published,
    summary: plain(status.spoiler_text),
    contentHtml: sanitize(str(status.content)) || undefined,
    url: httpsUrl(status.url) ?? uri,
    author: ctx.author ?? restAuthor(status.account, host),
    media: restMedia(status),
    isFinalResult: false,
    hidden: !isPublic || str(status.in_reply_to_id) !== undefined,
    raw: status,
  });
}
