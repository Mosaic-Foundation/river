// Boost, favourite and follow through a linked fediverse account (fediverse-posting-1.md items 2
// and 4; ADR-010 §3, §8): the API calls and the words. No React, so tests/unit/ui/ covers the
// words and the choices. Every value from a server is shown as text by the page.
import type { ActivityEntry } from "./activity";
import { call, type Answer } from "./compose";
import type { LinkedAccount } from "./linkedAccounts";

export type StatusToggle = "boost" | "unboost" | "favourite" | "unfavourite";
export type FollowToggle = "follow" | "unfollow";

export interface ToggleResult {
  id: string | null;
  status: "sent" | "failed" | "unknown";
  verb: StatusToggle | FollowToggle;
  /** Boosted, favourited or following afterwards, as the server answered; null when unknown. */
  on: boolean | null;
  /** A locked account: the follow waits for approval. */
  requested: boolean;
  error: string | null;
  message: string;
  retryAt: string | null;
  /** The link's first toggle: show item 4's note. */
  firstToggle: boolean;
}

export interface RiverToggles {
  items: Record<string, { boost: string[]; favourite: string[] }>;
  toggledLinks: string[];
}

export interface Relationship {
  following: boolean;
  requested: boolean;
}

/** The server takes at most this many items per ask. */
export const TOGGLE_BATCH = 100;

export function loadRiverToggles(itemIds: string[]): Promise<Answer<RiverToggles>> {
  return call<RiverToggles>(`/api/acts/fediverse/toggles?itemIds=${encodeURIComponent(itemIds.slice(0, TOGGLE_BATCH).join(","))}`);
}

/** What the member's own server says about a card's post (item 4's starting state). */
export function loadStatusState(linkedAccountId: string, itemId: string): Promise<Answer<{ reblogged: boolean; favourited: boolean }>> {
  return call<{ reblogged: boolean; favourited: boolean }>(
    `/api/acts/fediverse/state?linkedAccountId=${encodeURIComponent(linkedAccountId)}&itemId=${encodeURIComponent(itemId)}`,
  );
}

/** Asks for every id, TOGGLE_BATCH at a time, and joins the answers. */
export async function loadAllRiverToggles(itemIds: string[]): Promise<RiverToggles> {
  const batches: string[][] = [];
  for (let i = 0; i < itemIds.length; i += TOGGLE_BATCH) batches.push(itemIds.slice(i, i + TOGGLE_BATCH));
  const answers = await Promise.all(batches.map((b) => loadRiverToggles(b)));
  const joined: RiverToggles = { items: {}, toggledLinks: [] };
  for (const answer of answers) {
    if (!answer.ok) continue;
    Object.assign(joined.items, answer.body.items);
    for (const link of answer.body.toggledLinks) if (!joined.toggledLinks.includes(link)) joined.toggledLinks.push(link);
  }
  return joined;
}

export function togglePost(linkedAccountId: string, itemId: string, verb: StatusToggle): Promise<Answer<ToggleResult>> {
  return call<ToggleResult>("/api/acts/fediverse/toggle", { method: "POST", body: JSON.stringify({ linkedAccountId, itemId, verb }) });
}

export function followSpace(linkedAccountId: string, spaceId: string, verb: FollowToggle): Promise<Answer<ToggleResult>> {
  return call<ToggleResult>("/api/acts/fediverse/follow", { method: "POST", body: JSON.stringify({ linkedAccountId, spaceId, verb }) });
}

export function loadRelationship(linkedAccountId: string, spaceId: string): Promise<Answer<Relationship>> {
  return call<Relationship>(
    `/api/acts/fediverse/relationship?linkedAccountId=${encodeURIComponent(linkedAccountId)}&spaceId=${encodeURIComponent(spaceId)}`,
  );
}

export function undoAct(id: string): Promise<Answer<ToggleResult>> {
  return call<ToggleResult>(`/api/acts/${encodeURIComponent(id)}/undo`, { method: "POST" });
}

/** Item 4's one-time note. */
export function firstToggleNote(handle: string): string {
  return `Boosts, favourites and follows from the River are made publicly as ${handle}.`;
}

/** The account toggles use (item 2.5): the active one used last, else the one linked last. */
export function defaultAccount(accounts: readonly LinkedAccount[]): LinkedAccount | undefined {
  const time = (a: LinkedAccount) => Date.parse(a.lastUsedAt ?? a.linkedAt) || 0;
  return accounts
    .filter((a) => a.status === "active")
    .reduce<LinkedAccount | undefined>((best, a) => (best === undefined || time(a) > time(best) ? a : best), undefined);
}

/** The words on a card's toggle, and its accessible name ("Boost as @ana@example.social"). */
export function toggleLabel(kind: "boost" | "favourite", on: boolean): string {
  if (kind === "boost") return on ? "Boosted" : "Boost";
  return on ? "Favourited" : "Favourite";
}

/** A Following row's follow button (item 2.2): Follow, Unfollow, or Requested for a locked account. */
export function followLabel(state: Relationship | null): string {
  if (!state) return "Follow";
  if (state.following) return "Unfollow";
  if (state.requested) return "Requested";
  return "Follow";
}

/** A boost, favourite or follow sent from the River can be undone from Your activity (ADR-010 §8). */
export function canUndo(entry: ActivityEntry): boolean {
  return entry.channel === "fediverse" && (entry.verb === "boost" || entry.verb === "favourite" || entry.verb === "follow") && entry.status === "sent";
}

/** The Undo button's words in Your activity. */
export function undoLabel(verb: string): string {
  switch (verb) {
    case "boost":
      return "Undo this boost";
    case "favourite":
      return "Undo this favourite";
    default:
      return "Unfollow";
  }
}
