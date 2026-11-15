// Boost, favourite and follow through a member's linked fediverse account, and their undo
// (fediverse-posting-1.md items 2.1, 2.2 and 4; ADR-010 §3, §8, §9; ADR-011 items 4 and 6).
//
//   statusState()    whether the member has boosted or favourited a River item, from the search
//                    that resolves it on their server (item 4: the toggles' starting state).
//   togglePost()     Boost, Unboost, Favourite or Unfavourite a River item: resolve it on the
//                    member's server, write the act under the account's lock (no preview: a
//                    toggle is one click, ADR-010 §3), then
//                    `POST /api/v1/statuses/:id/{reblog,unreblog,favourite,unfavourite}`.
//   relationship()   whether the member's account follows a fediverse space's actor, from
//                    `GET /api/v1/accounts/relationships`.
//   followSpace()    Follow or Unfollow a fediverse space's actor as the linked account
//                    (`POST /api/v1/accounts/:id/{follow,unfollow}`). Following on the server is
//                    separate from following the space in the River; neither does the other.
//   undoToggle()     Undo from Your activity: the opposite request on the same server-local id
//                    as the original, with no new search.
//
// An undo is an act of its own, pointing at the original (ADR-010 §8); when the server confirms,
// the original reads `undone`. A search that fails sends nothing and writes no act (ADR-010 §9).
// Every request carries the member's token and refuses redirects. Nothing here logs or returns a
// token.
import { forAccount, forInstance } from "../../../db/context.js";
import { FetchError, type FetchGuard } from "../../../shared/fetch/index.js";
import { isObject, str } from "../../adapters/fediverse/activitypub.js";
import { ActRefused, finishAct, startToggle, type Actor, type ActOutcome } from "../acts.js";
import type { Verb } from "../limits.js";
import {
  httpsOrUndefined,
  loadLink,
  markRevoked,
  PostError,
  postMessage,
  readJson,
  replyTarget,
  resolveStatus,
  retryAfter,
  searchOnServer,
  theirWords,
  type Link,
  type PostErrorCode,
} from "./posts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const STATUS_TOGGLES = ["boost", "unboost", "favourite", "unfavourite"] as const;
export type StatusToggle = (typeof STATUS_TOGGLES)[number];
export const FOLLOW_TOGGLES = ["follow", "unfollow"] as const;
export type FollowToggle = (typeof FOLLOW_TOGGLES)[number];
type ToggleVerb = StatusToggle | FollowToggle;

/** Item 4's table: each verb's path segment. */
const SEGMENT: Record<ToggleVerb, string> = {
  boost: "reblog",
  unboost: "unreblog",
  favourite: "favourite",
  unfavourite: "unfavourite",
  follow: "follow",
  unfollow: "unfollow",
};

/** The verb an undo undoes, and the undo of a verb. */
const UNDOES: Partial<Record<ToggleVerb, ToggleVerb>> = { unboost: "boost", unfavourite: "favourite", unfollow: "follow" };
const UNDO_OF: Partial<Record<Verb, ToggleVerb>> = { boost: "unboost", favourite: "unfavourite", follow: "unfollow" };

/** What a toggle did. `on` is the state the server reports afterwards (null when unknown). */
export interface ToggleResult {
  /** The act's row; null when nothing was written. */
  id: string | null;
  status: "sent" | "failed" | "unknown";
  verb: ToggleVerb;
  /** Boosted, favourited or following after the act, as the server answered. */
  on: boolean | null;
  /** A follow of a locked account waits for approval: "Requested" (item 4). */
  requested: boolean;
  error: PostErrorCode | null;
  message: string;
  retryAt: string | null;
  /** This was the link's first toggle: the UI shows item 4's one-time note. */
  firstToggle: boolean;
}

export interface StatusState {
  reblogged: boolean;
  favourited: boolean;
}

export interface Relationship {
  following: boolean;
  requested: boolean;
}

// ---------------------------------------------------------------------------------------------
// Reading the starting state
// ---------------------------------------------------------------------------------------------

function readLinkId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new PostError("no_link", "Choose one of your linked accounts.");
  return value;
}

async function itemUri(actor: Actor, itemId: unknown): Promise<{ itemId: string; uri: string; title: string; url: string | null }> {
  const target = typeof itemId === "string" ? await replyTarget(actor.instanceId, itemId) : undefined;
  if (!target) throw new PostError("not_found", "The River can't boost or favourite this item.");
  return target;
}

/** Item 4: the search answer's `reblogged` and `favourited` set the toggles' starting state. */
export async function statusState(guard: FetchGuard, actor: Actor, linkedAccountId: unknown, itemId: unknown): Promise<StatusState> {
  const link = await loadLink(actor, readLinkId(linkedAccountId));
  const target = await itemUri(actor, itemId);
  const { reblogged, favourited } = await resolveStatus(guard, actor, link, target.uri);
  return { reblogged, favourited };
}

interface SpaceTarget {
  spaceId: string;
  actorUri: string;
  name: string;
  url: string | null;
}

/** A fediverse space the member may follow on their server: its actor's URI. */
async function spaceTarget(instanceId: string, spaceId: unknown): Promise<SpaceTarget> {
  const refused = new PostError("not_found", "The River can't follow this source on the fediverse.");
  if (typeof spaceId !== "string" || !UUID.test(spaceId)) throw refused;
  const row = await forInstance(instanceId, async (db) => {
    const { rows } = await db.query<{ id: string; name: string; actor_id: string | null; canonical_url: string; home_url: string | null }>(
      "SELECT id, name, actor_id, canonical_url, home_url FROM river.spaces WHERE id = $1 AND adapter = 'fediverse'",
      [spaceId],
    );
    return rows[0];
  });
  const actorUri = row ? (httpsOrUndefined(row.actor_id) ?? httpsOrUndefined(row.canonical_url)) : undefined;
  if (!row || !actorUri) throw refused;
  return { spaceId: row.id, actorUri, name: row.name, url: httpsOrUndefined(row.home_url) ?? actorUri };
}

/** The space's actor as the member's server knows it: its local account id. */
async function resolveAccount(guard: FetchGuard, actor: Actor, link: Link, uri: string): Promise<string> {
  const first = await searchOnServer(guard, actor, link, uri, "accounts");
  const id = first ? str(first.id) : undefined;
  if (!id || !LOCAL_ID.test(id)) throw new PostError("not_found", `${link.host} couldn't find this account.`);
  return id;
}

/** `GET /api/v1/accounts/relationships?id[]=…`: whether the linked account follows the space's actor. */
export async function relationship(guard: FetchGuard, actor: Actor, linkedAccountId: unknown, spaceId: unknown): Promise<Relationship> {
  const link = await loadLink(actor, readLinkId(linkedAccountId));
  const space = await spaceTarget(actor.instanceId, spaceId);
  const accountId = await resolveAccount(guard, actor, link, space.actorUri);
  const url = new URL(`https://${link.host}/api/v1/accounts/relationships`);
  url.searchParams.append("id[]", accountId);
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
  if (res.status === 429) throw new PostError("rate_limited", postMessage("rate_limited", link.host, link.handle), retryAfter(res, new Date()));
  if (res.status !== 200 || !Array.isArray(body)) throw new PostError("unreachable", postMessage("unreachable", link.host, link.handle));
  const rel = body.find((r): r is Record<string, unknown> => isObject(r) && str(r.id) === accountId);
  return { following: rel?.following === true, requested: rel?.requested === true };
}

// ---------------------------------------------------------------------------------------------
// Sending a toggle
// ---------------------------------------------------------------------------------------------

/** The request a toggle sends (stored as the act's request, never a credential). */
interface ToggleRequest {
  method: "POST";
  url: string;
  body?: { visibility: "public" };
}

function toggleRequest(link: Link, verb: ToggleVerb, localId: string): ToggleRequest {
  const kind = verb === "follow" || verb === "unfollow" ? "accounts" : "statuses";
  const url = `https://${link.host}/api/v1/${kind}/${localId}/${SEGMENT[verb]}`;
  // Item 4: a boost is public.
  return verb === "boost" ? { method: "POST", url, body: { visibility: "public" } } : { method: "POST", url };
}

/** Whether the link has made a toggle before (item 4's one-time note). */
async function hasToggled(actor: Actor, linkId: string): Promise<boolean> {
  return forAccount(actor.instanceId, actor.accountId, async (db) => {
    const { rows } = await db.query<{ found: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM river.member_actions
                       WHERE linked_account_id = $1 AND limit_kind IN ('toggle', 'follow') AND status <> 'previewed') AS found`,
      [linkId],
    );
    return rows[0]?.found === true;
  });
}

/** The newest `sent` act of `verb` through this link that matches. */
async function latestSent(actor: Actor, linkId: string, verb: ToggleVerb, match: { itemId: string } | { url: string }): Promise<string | undefined> {
  return forAccount(actor.instanceId, actor.accountId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      "itemId" in match
        ? `SELECT id FROM river.member_actions WHERE linked_account_id = $1 AND verb = $2 AND status = 'sent' AND item_id = $3
            ORDER BY sent_at DESC LIMIT 1`
        : `SELECT id FROM river.member_actions WHERE linked_account_id = $1 AND verb = $2 AND status = 'sent' AND request->>'url' = $3
            ORDER BY sent_at DESC LIMIT 1`,
      [linkId, verb, "itemId" in match ? match.itemId : match.url],
    );
    return rows[0]?.id;
  });
}

interface Subject {
  itemId?: string;
  title?: string;
  url?: string | null;
}

function refusal(err: ActRefused, link: Link, verb: ToggleVerb): PostError {
  switch (err.code) {
    case "limit":
      return new PostError(
        "limit",
        verb === "follow" || verb === "unfollow"
          ? "You've followed and unfollowed a lot from the River today. Try again later."
          : "You've sent a lot from the River in the last hour. Try again later.",
        err.retryAt,
      );
    case "session_ended":
      return new PostError("session_ended", postMessage("session_ended", link.host, link.handle));
    default:
      return new PostError("no_link", "That account isn't linked any more. Link it again in Settings → Linked accounts.");
  }
}

/** Writes the act, sends it, records what came back. */
async function sendToggle(
  guard: FetchGuard,
  actor: Actor,
  link: Link,
  verb: ToggleVerb,
  request: ToggleRequest,
  subject: Subject,
  undoesId: string | undefined,
  at: Date,
): Promise<ToggleResult> {
  const firstToggle = !(await hasToggled(actor, link.id));
  let act;
  try {
    act = await startToggle(
      actor,
      {
        channel: "fediverse",
        verb,
        linkedAccountId: link.id,
        targetHost: link.host,
        targetLabel: link.handle,
        ...(subject.itemId ? { itemId: subject.itemId } : {}),
        ...(subject.title ? { subjectTitle: subject.title.slice(0, 1024) } : {}),
        ...(subject.url ? { subjectUrl: subject.url } : {}),
        ...(undoesId ? { undoesId } : {}),
        request,
      },
      at,
    );
  } catch (err) {
    if (err instanceof ActRefused) throw refusal(err, link, verb);
    throw err;
  }

  const result = async (
    outcome: ActOutcome,
    code: PostErrorCode | null,
    message: string,
    state: { on: boolean | null; requested?: boolean } = { on: null },
    retryAt?: Date,
  ): Promise<ToggleResult> => {
    await finishAct(actor, act.id, outcome);
    return {
      id: act.id,
      status: outcome.status === "held" ? "sent" : (outcome.status as ToggleResult["status"]),
      verb,
      on: state.on,
      requested: state.requested ?? false,
      error: code,
      message,
      retryAt: retryAt?.toISOString() ?? null,
      firstToggle,
    };
  };

  let res: Response;
  try {
    res = await guard.fetch(request.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${link.token}`,
        accept: "application/json",
        ...(request.body ? { "content-type": "application/json" } : {}),
      },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      redirect: "error",
    });
  } catch (err) {
    if (err instanceof FetchError && err.code === "timeout") {
      return result({ status: "unknown", errorCode: "timeout" }, null, postMessage("unknown", link.host, link.handle));
    }
    if (err instanceof FetchError && err.code === "retry_later") {
      const until = new Date(err.retryAt ?? Date.now());
      return result({ status: "failed", errorCode: "rate_limited" }, "rate_limited", postMessage("rate_limited", link.host, link.handle), { on: null }, until);
    }
    return result({ status: "failed", errorCode: "unreachable" }, "unreachable", postMessage("unreachable", link.host, link.handle));
  }
  const body = await readJson(res);
  if (res.status === 200) {
    const state = stateAfter(verb, body);
    const undone = UNDOES[verb];
    if (undone && undoesId) {
      await forAccount(actor.instanceId, actor.accountId, (db) =>
        db.query("UPDATE river.member_actions SET status = 'undone' WHERE id = $1 AND status = 'sent' AND verb = $2", [undoesId, undone]),
      );
    }
    const remoteId = isObject(body) ? str(body.id) : undefined;
    return result({ status: "sent", ...(remoteId ? { remoteId: remoteId.slice(0, 512) } : {}) }, null, doneMessage(verb, link, state), state);
  }
  if (res.status === 401) {
    await markRevoked(actor, link.id);
    return result({ status: "failed", errorCode: "revoked" }, "revoked", postMessage("revoked", link.host, link.handle));
  }
  if (res.status === 403) return result({ status: "failed", errorCode: "scope" }, "scope", postMessage("scope", link.host, link.handle));
  if (res.status === 404) {
    return result(
      { status: "failed", errorCode: "not_found" },
      "not_found",
      verb === "follow" || verb === "unfollow" ? `${link.host} couldn't find this account.` : postMessage("not_found", link.host, link.handle),
    );
  }
  if (res.status === 422) {
    const words = theirWords(body);
    return result(
      { status: "failed", errorCode: "rejected", ...(words ? { errorMessage: words } : {}) },
      "rejected",
      postMessage("rejected", link.host, link.handle, words),
    );
  }
  if (res.status === 429) {
    return result(
      { status: "failed", errorCode: "rate_limited" },
      "rate_limited",
      postMessage("rate_limited", link.host, link.handle),
      { on: null },
      retryAfter(res, new Date()),
    );
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return result({ status: "unknown", errorCode: `http_${res.status}` }, null, postMessage("unknown", link.host, link.handle));
  }
  return result({ status: "failed", errorCode: `http_${res.status}` }, "unreachable", postMessage("unreachable", link.host, link.handle));
}

/** The state the server reports after a successful toggle. */
function stateAfter(verb: ToggleVerb, body: unknown): { on: boolean; requested: boolean } {
  const obj = isObject(body) ? body : {};
  switch (verb) {
    case "boost":
      // The answer is the new boost; the boosted post (with `reblogged`) is its `reblog`.
      return { on: isObject(obj.reblog) ? obj.reblog.reblogged !== false : true, requested: false };
    case "unboost":
      return { on: obj.reblogged === true, requested: false };
    case "favourite":
    case "unfavourite":
      return { on: typeof obj.favourited === "boolean" ? obj.favourited : verb === "favourite", requested: false };
    case "follow":
    case "unfollow":
      return { on: obj.following === true, requested: obj.requested === true };
  }
}

function doneMessage(verb: ToggleVerb, link: Link, state: { on: boolean; requested: boolean }): string {
  switch (verb) {
    case "boost":
      return `Boosted as ${link.handle}`;
    case "unboost":
      return `Boost undone on ${link.host}`;
    case "favourite":
      return `Favourited as ${link.handle}`;
    case "unfavourite":
      return `Favourite undone on ${link.host}`;
    case "follow":
      return state.requested ? `Requested to follow as ${link.handle}` : `Following as ${link.handle}`;
    case "unfollow":
      return `Unfollowed as ${link.handle}`;
  }
}

export interface ToggleInput {
  linkedAccountId: unknown;
  verb: unknown;
}

/** Boost, Unboost, Favourite or Unfavourite a live fediverse item (a boost card: the boosted post). */
export async function togglePost(
  guard: FetchGuard,
  actor: Actor,
  input: ToggleInput & { itemId: unknown },
  at = new Date(),
): Promise<ToggleResult> {
  const verb = input.verb as StatusToggle;
  if (!STATUS_TOGGLES.includes(verb)) throw new PostError("bad_input", "Choose boost, unboost, favourite or unfavourite.");
  const link = await loadLink(actor, readLinkId(input.linkedAccountId));
  const target = await itemUri(actor, input.itemId);
  const { id } = await resolveStatus(guard, actor, link, target.uri);
  const request = toggleRequest(link, verb, id);
  const undone = UNDOES[verb];
  const undoesId = undone ? await latestSent(actor, link.id, undone, { itemId: target.itemId }) : undefined;
  return sendToggle(guard, actor, link, verb, request, { itemId: target.itemId, title: target.title, url: target.url }, undoesId, at);
}

/** Follow or Unfollow a fediverse space's actor as the linked account. */
export async function followSpace(
  guard: FetchGuard,
  actor: Actor,
  input: ToggleInput & { spaceId: unknown },
  at = new Date(),
): Promise<ToggleResult> {
  const verb = input.verb as FollowToggle;
  if (!FOLLOW_TOGGLES.includes(verb)) throw new PostError("bad_input", "Choose follow or unfollow.");
  const link = await loadLink(actor, readLinkId(input.linkedAccountId));
  const space = await spaceTarget(actor.instanceId, input.spaceId);
  const accountId = await resolveAccount(guard, actor, link, space.actorUri);
  const request = toggleRequest(link, verb, accountId);
  const undoesId = verb === "unfollow" ? await latestSent(actor, link.id, "follow", { url: toggleRequest(link, "follow", accountId).url }) : undefined;
  return sendToggle(guard, actor, link, verb, request, { title: space.name, url: space.url }, undoesId, at);
}

interface OriginalRow {
  id: string;
  verb: Verb;
  linked_account_id: string | null;
  item_id: string | null;
  subject_title: string | null;
  subject_url: string | null;
  request: unknown;
}

/** Undo from Your activity: a sent boost, favourite or follow, by the same server-local id. */
export async function undoToggle(guard: FetchGuard, actor: Actor, originalId: string, at = new Date()): Promise<ToggleResult> {
  const cannot = new PostError("bad_input", "That isn't something from the River you can undo.");
  if (!UUID.test(originalId)) throw cannot;
  const original = await forAccount(actor.instanceId, actor.accountId, async (db) => {
    const { rows } = await db.query<OriginalRow>(
      `SELECT id, verb, linked_account_id, item_id, subject_title, subject_url, request FROM river.member_actions
        WHERE id = $1 AND channel = 'fediverse' AND verb IN ('boost', 'favourite', 'follow') AND status = 'sent'`,
      [originalId],
    );
    return rows[0];
  });
  const undo = original ? UNDO_OF[original.verb] : undefined;
  if (!original?.linked_account_id || !undo) throw cannot;
  const link = await loadLink(actor, original.linked_account_id);
  // The stored URL must be this link's server and the original verb's path: nothing else ever
  // receives the token.
  const url = isObject(original.request) ? str(original.request.url) : undefined;
  const kind = original.verb === "follow" ? "accounts" : "statuses";
  const match = url ? new RegExp(`^https://${link.host.replace(/\./g, "\\.")}/api/v1/${kind}/([A-Za-z0-9_-]{1,64})/${SEGMENT[original.verb as ToggleVerb]}$`).exec(url) : null;
  if (!match?.[1]) throw cannot;
  return sendToggle(
    guard,
    actor,
    link,
    undo,
    toggleRequest(link, undo, match[1]),
    { ...(original.item_id ? { itemId: original.item_id } : {}), ...(original.subject_title ? { title: original.subject_title } : {}), url: original.subject_url },
    original.id,
    at,
  );
}

// ---------------------------------------------------------------------------------------------
// What the River itself has done, for the cards (no request to any server)
// ---------------------------------------------------------------------------------------------

export const MAX_TOGGLE_ITEMS = 100;

export interface RiverToggles {
  /** Per item: the links that boosted or favourited it from the River and haven't undone it. */
  items: Record<string, { boost: string[]; favourite: string[] }>;
  /** Links that have made a toggle or follow before: item 4's note has been shown for them. */
  toggledLinks: string[];
}

/**
 * The cards' starting state: the River's own sent boosts and favourites on these items. Anything
 * done on the member's server itself shows once they toggle (the server's answer) or read the
 * state (`statusState`). Read only, from the River's rows.
 */
export async function riverToggles(actor: Actor, itemIds: unknown): Promise<RiverToggles> {
  const ids =
    typeof itemIds === "string" && itemIds !== ""
      ? [...new Set(itemIds.split(","))].filter((id) => UUID.test(id))
      : [];
  if (ids.length > MAX_TOGGLE_ITEMS) throw new PostError("bad_input", `Ask for at most ${MAX_TOGGLE_ITEMS} items.`);
  return forAccount(actor.instanceId, actor.accountId, async (db) => {
    const items: RiverToggles["items"] = {};
    if (ids.length > 0) {
      const { rows } = await db.query<{ item_id: string; verb: "boost" | "favourite"; linked_account_id: string }>(
        `SELECT DISTINCT item_id, verb, linked_account_id FROM river.member_actions
          WHERE item_id = ANY($1::uuid[]) AND channel = 'fediverse' AND verb IN ('boost', 'favourite')
            AND status = 'sent' AND linked_account_id IS NOT NULL`,
        [ids],
      );
      for (const row of rows) {
        const entry = (items[row.item_id] ??= { boost: [], favourite: [] });
        entry[row.verb].push(row.linked_account_id);
      }
    }
    const { rows: toggled } = await db.query<{ linked_account_id: string }>(
      `SELECT DISTINCT linked_account_id FROM river.member_actions
        WHERE channel = 'fediverse' AND limit_kind IN ('toggle', 'follow') AND status <> 'previewed' AND linked_account_id IS NOT NULL`,
    );
    return { items, toggledLinks: toggled.map((r) => r.linked_account_id) };
  });
}
