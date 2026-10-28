// Posts and replies through a member's linked fediverse account (fediverse-posting-1.md item 3;
// ADR-010 §4, §9; ADR-011 item 4).
//
//   composeInfo()  what the composer needs: the member's active links with their defaults and
//                  character limits, and the post being answered (its warning carried over).
//   previewPost()  builds the exact request and stores it as a preview (acts.ts). For a reply it
//                  first resolves the post on the member's own server (`GET /api/v2/search` with
//                  resolve=true), so the request names that server's local id. Nothing is sent.
//   sendPost()     Send: claims the preview under the account's lock (epoch, limits), then posts
//                  exactly the stored request with `Idempotency-Key: {the act's id}`.
//   retryPost()    Try again on an `unknown` post: the same request and key, on Mastodon only and
//                  within the hour Mastodon keeps the key (item 7).
//
// Every request carries the member's token and refuses redirects. Failures map to item 7's table;
// a 401 marks the link revoked and deletes its token. Nothing here logs or returns a token.
import { forAccount, forInstance } from "../../../db/context.js";
import { FetchError, type FetchGuard } from "../../../shared/fetch/index.js";
import { asList, idOf, isObject, str } from "../../adapters/fediverse/activitypub.js";
import { ActRefused, claimPreview, claimRetry, createPreview, finishAct, type Actor, type ActOutcome } from "../acts.js";
import { openCredential } from "../crypto/credentials.js";
import { readServerLimits, type ServerLimits } from "./instance.js";

export const VISIBILITIES = ["public", "unlisted", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Mastodon keeps an Idempotency-Key for an hour per account (item 7). */
export const RETRY_WINDOW_MS = 60 * 60 * 1000;
export const MAX_TEXT = 20_000;
export const MAX_WARNING = 2_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type PostErrorCode =
  | "bad_input"
  | "no_link"
  | "not_found"
  | "revoked"
  | "scope"
  | "rejected"
  | "rate_limited"
  | "unreachable"
  | "limit"
  | "session_ended"
  | "preview_expired"
  | "already_sent"
  | "cannot_retry";

/** A refusal before or instead of sending; the message is item 7's, naming the server. */
export class PostError extends Error {
  constructor(
    readonly code: PostErrorCode,
    message: string,
    /** For rate_limited and limit: when to try again. */
    readonly retryAt?: Date,
  ) {
    super(message);
    this.name = "PostError";
  }
}

export interface Link {
  id: string;
  host: string;
  /** `@ana@example.social`. */
  handle: string;
  software: "mastodon" | "gotosocial";
  token: string;
}

interface LinkRow {
  id: string;
  server_host: string;
  acct: string | null;
  actor_uri: string;
  software: "mastodon" | "gotosocial" | null;
  token_ciphertext: Buffer | null;
  token_dek: Buffer | null;
  token_key_version: number | null;
}

function handleOf(row: { acct: string | null; actor_uri: string }): string {
  return row.acct ? `@${row.acct}` : row.actor_uri;
}

/** The member's active fediverse link with its token opened, or a PostError. */
export async function loadLink(actor: Actor, linkedAccountId: string): Promise<Link> {
  if (!UUID.test(linkedAccountId)) throw new PostError("no_link", "Choose one of your linked accounts.");
  const row = await forAccount(actor.instanceId, actor.accountId, async (db) => {
    const { rows } = await db.query<LinkRow>(
      `SELECT id, server_host, acct, actor_uri, software, token_ciphertext, token_dek, token_key_version
         FROM river.linked_accounts WHERE id = $1 AND kind = 'fediverse' AND status = 'active'`,
      [linkedAccountId],
    );
    return rows[0];
  });
  if (!row || !row.token_ciphertext || !row.token_dek || !row.token_key_version || !row.software) {
    throw new PostError("no_link", "That account isn't linked any more. Link it again in Settings → Linked accounts.");
  }
  const token = openCredential(
    { instanceId: actor.instanceId, accountId: actor.accountId, rowId: row.id, purpose: "fediverse_token" },
    { ciphertext: row.token_ciphertext, wrappedDek: row.token_dek, keyVersion: row.token_key_version },
  );
  return { id: row.id, host: row.server_host, handle: handleOf(row), software: row.software, token };
}

/** A 401 from the server: the link is revoked there; forget its token here (ADR-010 §6). */
async function markRevoked(actor: Actor, linkId: string): Promise<void> {
  await forAccount(actor.instanceId, actor.accountId, (db) =>
    db.query(
      `UPDATE river.linked_accounts
          SET status = 'revoked', token_ciphertext = NULL, token_dek = NULL, token_key_version = NULL, revoked_at = now()
        WHERE id = $1 AND status = 'active'`,
      [linkId],
    ),
  );
}

/** Item 7's sentences. */
export function postMessage(code: PostErrorCode | "unknown", host: string, handle: string, detail?: string): string {
  switch (code) {
    case "revoked":
      return `Your link to ${handle} stopped working. Link it again.`;
    case "scope":
      return `${host} didn't allow this. Link the account again to allow it.`;
    case "not_found":
      return `${host} couldn't find this post.`;
    case "rejected":
      return `${host} says: ${detail ?? "no."}`;
    case "rate_limited":
      return `${host} asks you to wait.`;
    case "unknown":
      return `We couldn't tell whether ${host} got it.`;
    case "unreachable":
      return `We couldn't reach ${host}. Nothing was sent.`;
    case "limit":
      return "You've sent a lot from the River in the last hour. Try again later.";
    case "session_ended":
      return "Your session ended. Sign in again; nothing was sent.";
    case "preview_expired":
      return "This preview is out of date. Check it again.";
    case "already_sent":
      return "This was already sent. Check Your activity.";
    case "cannot_retry":
      return `It's too late to try again safely. Check on ${host}.`;
    default:
      return "That didn't work. Nothing was sent.";
  }
}

/** The other side's own words: plain text, at most 300 characters (ADR-010 §9). */
function theirWords(body: unknown): string | undefined {
  const error = isObject(body) ? str(body.error) : undefined;
  return error === undefined ? undefined : Array.from(error.replace(/\s+/g, " ").trim()).slice(0, 300).join("");
}

function retryAfter(res: Response, now: Date): Date | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = /^\d+$/.test(raw.trim()) ? Number(raw) * 1000 : Date.parse(raw) - now.getTime();
  return Number.isFinite(seconds) && seconds > 0 ? new Date(now.getTime() + Math.min(seconds, 24 * 3_600_000)) : undefined;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return JSON.parse(await res.text());
  } catch {
    return undefined;
  }
}

function httpsOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// The post being answered
// ---------------------------------------------------------------------------------------------

export interface ReplyTarget {
  itemId: string;
  /** The post's own URI, which the member's server resolves (a boost card: the boosted post). */
  uri: string;
  title: string;
  url: string | null;
  /** The content warning to start the reply with. */
  spoilerText: string;
  /** `@user@domain` to mention, when the River knows it. */
  mention: string | null;
}

interface ItemRow {
  id: string;
  title: string | null;
  summary: string | null;
  content_html: string | null;
  url: string | null;
  author: { name?: string; handle?: string; url?: string } | null;
  boost_of: { objectId?: string; url?: string; author?: { handle?: string } } | null;
  raw: unknown;
}

function plainExcerpt(html: string | null, max = 80): string {
  const text = (html ?? "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  return Array.from(text).length > max ? `${Array.from(text).slice(0, max - 1).join("")}…` : text;
}

/** The object's URI from what the adapter stored (spec 4.3 shapes). */
function objectUri(row: ItemRow): string | undefined {
  if (row.boost_of?.objectId) return httpsOrUndefined(row.boost_of.objectId);
  const raw = row.raw;
  if (isObject(raw)) {
    if (raw.type === "Create") return httpsOrUndefined(idOf(raw.object));
    if (isObject(raw.object) && "announce" in raw) return httpsOrUndefined(idOf(raw.object));
    if (raw.type !== "Announce" && raw.type !== "Update") return httpsOrUndefined(raw.id) ?? httpsOrUndefined(row.url);
  }
  return httpsOrUndefined(row.url);
}

/** A live fediverse item the member may answer; undefined for anything else (samples, hubs, feeds, Bluesky). */
export async function replyTarget(instanceId: string, itemId: string): Promise<ReplyTarget | undefined> {
  if (!UUID.test(itemId)) return undefined;
  const row = await forInstance(instanceId, async (db) => {
    const { rows } = await db.query<ItemRow>(
      `SELECT i.id, i.title, i.summary, i.content_html, i.url, i.author, i.boost_of, i.raw
         FROM river.items i JOIN river.spaces s ON s.id = i.space_id
        WHERE i.id = $1 AND s.adapter = 'fediverse' AND NOT i.hidden`,
      [itemId],
    );
    return rows[0];
  });
  if (!row) return undefined;
  const uri = objectUri(row);
  if (!uri) return undefined;
  const handle = row.boost_of?.author?.handle ?? row.author?.handle;
  const mention = handle && /^@[a-z0-9_.-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(handle) ? handle : null;
  const who = row.author?.name ?? handle ?? "a post";
  return {
    itemId: row.id,
    uri,
    title: row.title ?? `${who}: ${plainExcerpt(row.content_html)}`,
    url: httpsOrUndefined(row.boost_of?.url ?? row.url) ?? null,
    spoilerText: row.summary ?? "",
    mention,
  };
}

/** `GET /api/v2/search?q={uri}&resolve=true&type=statuses&limit=1`: the post's id on the member's server. */
export async function resolveOnServer(guard: FetchGuard, actor: Actor, link: Link, uri: string): Promise<string> {
  const url = new URL(`https://${link.host}/api/v2/search`);
  url.search = new URLSearchParams({ q: uri, resolve: "true", type: "statuses", limit: "1" }).toString();
  let res: Response;
  try {
    res = await guard.fetch(url.toString(), {
      headers: { authorization: `Bearer ${link.token}`, accept: "application/json" },
      redirect: "error",
    });
  } catch (err) {
    if (err instanceof FetchError && err.code === "retry_later") {
      throw new PostError("rate_limited", postMessage("rate_limited", link.host, link.handle), new Date(err.retryAt ?? Date.now()));
    }
    throw new PostError("unreachable", postMessage("unreachable", link.host, link.handle));
  }
  const body = await readJson(res);
  if (res.status === 401) {
    await markRevoked(actor, link.id);
    throw new PostError("revoked", postMessage("revoked", link.host, link.handle));
  }
  if (res.status === 403) throw new PostError("scope", postMessage("scope", link.host, link.handle));
  if (res.status === 429) {
    throw new PostError("rate_limited", postMessage("rate_limited", link.host, link.handle), retryAfter(res, new Date()));
  }
  if (res.status !== 200) throw new PostError("unreachable", postMessage("unreachable", link.host, link.handle));
  const first = isObject(body) ? asList(body.statuses).find(isObject) : undefined;
  const id = first ? str(first.id) : undefined;
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new PostError("not_found", postMessage("not_found", link.host, link.handle));
  return id;
}

// ---------------------------------------------------------------------------------------------
// The composer's facts
// ---------------------------------------------------------------------------------------------

export interface ComposeAccount {
  id: string;
  handle: string;
  server: string;
  software: "mastodon" | "gotosocial";
  defaultVisibility: Visibility;
  defaultLanguage: string | null;
  limits: ServerLimits;
}

export async function composeInfo(
  guard: FetchGuard,
  actor: Actor,
  replyToItemId: string | undefined,
): Promise<{ accounts: ComposeAccount[]; replyTo: Omit<ReplyTarget, "uri"> | null }> {
  const rows = await forAccount(actor.instanceId, actor.accountId, async (db) => {
    const { rows } = await db.query<{
      id: string;
      server_host: string;
      acct: string | null;
      actor_uri: string;
      software: "mastodon" | "gotosocial";
      default_visibility: Visibility | null;
      default_language: string | null;
      last_used_at: Date | null;
      linked_at: Date;
    }>(
      `SELECT id, server_host, acct, actor_uri, software, default_visibility, default_language, last_used_at, linked_at
         FROM river.linked_accounts
        WHERE kind = 'fediverse' AND status = 'active' AND software IS NOT NULL
        ORDER BY coalesce(last_used_at, linked_at) DESC, id`,
    );
    return rows;
  });
  const accounts: ComposeAccount[] = [];
  for (const row of rows) {
    accounts.push({
      id: row.id,
      handle: handleOf(row),
      server: row.server_host,
      software: row.software,
      defaultVisibility: row.default_visibility ?? "public",
      defaultLanguage: row.default_language,
      limits: await readServerLimits(guard, row.server_host, row.software),
    });
  }
  let replyTo: Omit<ReplyTarget, "uri"> | null = null;
  if (replyToItemId !== undefined) {
    const target = await replyTarget(actor.instanceId, replyToItemId);
    if (!target) throw new PostError("not_found", "The River can't reply to this item.");
    const { uri: _uri, ...rest } = target;
    replyTo = rest;
  }
  return { accounts, replyTo };
}

// ---------------------------------------------------------------------------------------------
// Preview, Send, Try again
// ---------------------------------------------------------------------------------------------

export interface PostInput {
  linkedAccountId: unknown;
  text: unknown;
  spoilerText?: unknown;
  visibility?: unknown;
  language?: unknown;
  replyToItemId?: unknown;
}

/** The stored request: what the preview shows and Send sends, never a credential. */
export interface PostRequest {
  method: "POST";
  url: string;
  body: {
    status: string;
    visibility: Visibility;
    spoiler_text?: string;
    in_reply_to_id?: string;
    language?: string;
  };
}

export interface PreviewView {
  id: string;
  verb: "post" | "reply";
  as: string;
  server: string;
  request: PostRequest;
  replyTo: { title: string; url: string | null } | null;
  expiresAt: string;
}

function readText(value: unknown, max: number, field: string, required: boolean): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new PostError("bad_input", "Write something first.");
    return undefined;
  }
  if (typeof value !== "string" || Array.from(value).length > max) throw new PostError("bad_input", `The ${field} is too long.`);
  if (required && value.trim() === "") throw new PostError("bad_input", "Write something first.");
  return value;
}

export async function previewPost(guard: FetchGuard, actor: Actor, input: PostInput, at = new Date()): Promise<PreviewView> {
  const text = readText(input.text, MAX_TEXT, "post", true) as string;
  const spoiler = readText(input.spoilerText, MAX_WARNING, "content warning", false);
  const visibility = (input.visibility ?? "public") as Visibility;
  if (!VISIBILITIES.includes(visibility)) throw new PostError("bad_input", "Choose Public, Quiet public or Followers only.");
  const language = input.language === undefined || input.language === null || input.language === "" ? undefined : input.language;
  if (language !== undefined && (typeof language !== "string" || !/^[a-z]{2,3}$/.test(language))) {
    throw new PostError("bad_input", "That language code isn't one the River knows.");
  }
  if (typeof input.linkedAccountId !== "string") throw new PostError("no_link", "Choose one of your linked accounts.");
  const link = await loadLink(actor, input.linkedAccountId);

  let target: ReplyTarget | undefined;
  let inReplyTo: string | undefined;
  if (input.replyToItemId !== undefined && input.replyToItemId !== null) {
    if (typeof input.replyToItemId !== "string") throw new PostError("bad_input", "The River can't reply to this item.");
    target = await replyTarget(actor.instanceId, input.replyToItemId);
    if (!target) throw new PostError("not_found", "The River can't reply to this item.");
    inReplyTo = await resolveOnServer(guard, actor, link, target.uri);
  }

  const request: PostRequest = {
    method: "POST",
    url: `https://${link.host}/api/v1/statuses`,
    body: {
      status: text,
      visibility,
      ...(spoiler ? { spoiler_text: spoiler } : {}),
      ...(inReplyTo ? { in_reply_to_id: inReplyTo } : {}),
      ...(language ? { language: language as string } : {}),
    },
  };
  const verb = target ? "reply" : "post";
  let row;
  try {
    row = await createPreview(
      actor,
      {
        channel: "fediverse",
        verb,
        linkedAccountId: link.id,
        targetHost: link.host,
        targetLabel: link.handle,
        ...(target ? { itemId: target.itemId, subjectTitle: target.title.slice(0, 1024), ...(target.url ? { subjectUrl: target.url } : {}) } : {}),
        request,
      },
      at,
    );
  } catch (err) {
    if (err instanceof ActRefused) throw refusal(err, link);
    throw err;
  }
  return {
    id: row.id,
    verb,
    as: link.handle,
    server: link.host,
    request,
    replyTo: target ? { title: target.title, url: target.url } : null,
    expiresAt: new Date(row.created_at.getTime() + 15 * 60_000).toISOString(),
  };
}

function refusal(err: ActRefused, link: { host: string; handle: string }): PostError {
  switch (err.code) {
    case "limit":
      return new PostError("limit", postMessage("limit", link.host, link.handle), err.retryAt);
    case "session_ended":
      return new PostError("session_ended", postMessage("session_ended", link.host, link.handle));
    case "preview_expired":
      return new PostError("preview_expired", postMessage("preview_expired", link.host, link.handle));
    case "already_sent":
      return new PostError("already_sent", postMessage("already_sent", link.host, link.handle));
    case "link_inactive":
      return new PostError("no_link", "That account isn't linked any more. Link it again in Settings → Linked accounts.");
    default:
      return new PostError("bad_input", "That preview isn't yours or doesn't exist.");
  }
}

export interface SendResult {
  id: string;
  status: "sent" | "failed" | "unknown";
  remoteUrl: string | null;
  error: PostErrorCode | null;
  message: string;
  retryAt: string | null;
  /** Mastodon, unknown, within the hour: Try again is safe. */
  canRetry: boolean;
  /** Where to look on the server ("Check on example.social ↗"). */
  checkUrl: string;
}

/** Sends a claimed act's stored request with its Idempotency-Key, and records what came back. */
async function deliver(guard: FetchGuard, actor: Actor, actId: string, request: PostRequest, link: Link, sentAt: Date): Promise<SendResult> {
  // The account's profile on its server: "@ana@example.social" → https://{server}/@ana.
  const checkUrl = `https://${link.host}/${link.handle.split("@").slice(0, 2).join("@")}`;
  const finish = async (outcome: ActOutcome, code: PostErrorCode | null, message: string, retryAt?: Date): Promise<SendResult> => {
    await finishAct(actor, actId, outcome);
    const canRetry =
      outcome.status === "unknown" && link.software === "mastodon" && Date.now() - sentAt.getTime() < RETRY_WINDOW_MS;
    return {
      id: actId,
      status: outcome.status === "held" ? "sent" : outcome.status,
      remoteUrl: outcome.remoteUrl ?? null,
      error: code,
      message,
      retryAt: retryAt?.toISOString() ?? null,
      canRetry,
      checkUrl,
    };
  };

  // The stored URL must still be this link's server: nothing else ever receives the token.
  if (request.method !== "POST" || request.url !== `https://${link.host}/api/v1/statuses`) {
    return finish({ status: "failed", errorCode: "bad_request" }, "unreachable", postMessage("unreachable", link.host, link.handle));
  }
  let res: Response;
  try {
    res = await guard.fetch(request.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${link.token}`,
        "content-type": "application/json",
        accept: "application/json",
        "idempotency-key": actId,
      },
      body: JSON.stringify(request.body),
      redirect: "error",
    });
  } catch (err) {
    if (err instanceof FetchError && err.code === "timeout") {
      return finish({ status: "unknown", errorCode: "timeout" }, null, postMessage("unknown", link.host, link.handle));
    }
    if (err instanceof FetchError && err.code === "retry_later") {
      const until = new Date(err.retryAt ?? Date.now());
      return finish({ status: "failed", errorCode: "rate_limited" }, "rate_limited", postMessage("rate_limited", link.host, link.handle), until);
    }
    return finish({ status: "failed", errorCode: "unreachable" }, "unreachable", postMessage("unreachable", link.host, link.handle));
  }
  const body = await readJson(res);
  if (res.status === 200) {
    const remoteId = isObject(body) ? str(body.id) : undefined;
    const remoteUrl = isObject(body) ? (httpsOrUndefined(body.url) ?? httpsOrUndefined(body.uri)) : undefined;
    return finish(
      { status: "sent", ...(remoteId ? { remoteId: remoteId.slice(0, 512) } : {}), ...(remoteUrl ? { remoteUrl } : {}) },
      null,
      `Posted on ${link.host}`,
    );
  }
  if (res.status === 401) {
    await markRevoked(actor, link.id);
    return finish({ status: "failed", errorCode: "revoked" }, "revoked", postMessage("revoked", link.host, link.handle));
  }
  if (res.status === 403) return finish({ status: "failed", errorCode: "scope" }, "scope", postMessage("scope", link.host, link.handle));
  if (res.status === 404) return finish({ status: "failed", errorCode: "not_found" }, "not_found", postMessage("not_found", link.host, link.handle));
  if (res.status === 422) {
    const words = theirWords(body);
    return finish(
      { status: "failed", errorCode: "rejected", ...(words ? { errorMessage: words } : {}) },
      "rejected",
      postMessage("rejected", link.host, link.handle, words),
    );
  }
  if (res.status === 429) {
    return finish(
      { status: "failed", errorCode: "rate_limited" },
      "rate_limited",
      postMessage("rate_limited", link.host, link.handle),
      retryAfter(res, new Date()),
    );
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return finish({ status: "unknown", errorCode: `http_${res.status}` }, null, postMessage("unknown", link.host, link.handle));
  }
  return finish({ status: "failed", errorCode: `http_${res.status}` }, "unreachable", postMessage("unreachable", link.host, link.handle));
}

function isPostRequest(value: unknown): value is PostRequest {
  return isObject(value) && value.method === "POST" && typeof value.url === "string" && isObject(value.body);
}

/** Send: the preview, exactly as stored. */
export async function sendPost(guard: FetchGuard, actor: Actor, actId: string, at = new Date()): Promise<SendResult> {
  if (!UUID.test(actId)) throw new PostError("bad_input", "That preview isn't yours or doesn't exist.");
  let claimed;
  try {
    claimed = await claimPreview(actor, actId, at);
  } catch (err) {
    if (err instanceof ActRefused) throw refusal(err, { host: "the server", handle: "this account" });
    throw err;
  }
  return sendClaimed(guard, actor, claimed, at);
}

/** Try again: an `unknown` post, the same request and Idempotency-Key, Mastodon only, within the hour. */
export async function retryPost(guard: FetchGuard, actor: Actor, actId: string, at = new Date()): Promise<SendResult> {
  if (!UUID.test(actId)) throw new PostError("bad_input", "That post isn't yours or doesn't exist.");
  const linkId = await forAccount(actor.instanceId, actor.accountId, async (db) => {
    const { rows } = await db.query<{ linked_account_id: string | null }>(
      "SELECT linked_account_id FROM river.member_actions WHERE id = $1 AND channel = 'fediverse' AND verb IN ('post', 'reply')",
      [actId],
    );
    return rows[0]?.linked_account_id ?? undefined;
  });
  if (!linkId) throw new PostError("bad_input", "That post isn't yours or doesn't exist.");
  const link = await loadLink(actor, linkId);
  // GoToSocial's Idempotency-Key isn't checked: a second send could post twice (item 7).
  if (link.software !== "mastodon") throw new PostError("cannot_retry", postMessage("cannot_retry", link.host, link.handle));
  let claimed;
  try {
    claimed = await claimRetry(actor, actId, RETRY_WINDOW_MS, at);
  } catch (err) {
    if (err instanceof ActRefused) {
      if (err.code === "already_sent" || err.code === "preview_expired") {
        throw new PostError("cannot_retry", postMessage("cannot_retry", link.host, link.handle));
      }
      throw refusal(err, link);
    }
    throw err;
  }
  return sendClaimed(guard, actor, claimed, claimed.sent_at ?? at);
}

async function sendClaimed(
  guard: FetchGuard,
  actor: Actor,
  claimed: { id: string; verb: string; request: unknown; linked_account_id: string | null },
  sentAt: Date,
): Promise<SendResult> {
  const fail = async (code: PostErrorCode, message: string): Promise<never> => {
    await finishAct(actor, claimed.id, { status: "failed", errorCode: code });
    throw new PostError(code, message);
  };
  if ((claimed.verb !== "post" && claimed.verb !== "reply") || !isPostRequest(claimed.request) || !claimed.linked_account_id) {
    return fail("bad_input", "That isn't a post the River can send.");
  }
  let link: Link;
  try {
    link = await loadLink(actor, claimed.linked_account_id);
  } catch (err) {
    if (err instanceof PostError) return fail(err.code, err.message);
    throw err;
  }
  return deliver(guard, actor, claimed.id, claimed.request, link, sentAt);
}
