// Your activity (ADR-010 §7): what the River sent in the member's name. The API call and the words
// for each entry; no React, so tests/unit/ui/ covers the words.
import type { Viewer } from "./api";

export type ActivityStatus = "sent" | "held" | "failed" | "unknown" | "undone";

export interface ActivityEntry {
  id: string;
  at: string;
  channel: "fediverse" | "space";
  verb: string;
  status: ActivityStatus;
  targetHost: string;
  targetLabel: string | null;
  subjectTitle: string | null;
  subjectUrl: string | null;
  remoteUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  undoesId: string | null;
}

export type ActivityResult =
  | { status: "ok"; viewer: Viewer; entries: ActivityEntry[]; nextCursor: string | null }
  | { status: "signed_out" }
  | { status: "error" };

/** One page of the member's activity (GET /api/activity). */
export async function loadActivity(cursor?: string, signal?: AbortSignal): Promise<ActivityResult> {
  let res: Response;
  try {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    res = await fetch(`/api/activity${query}`, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { status: "error" };
  }
  if (res.status === 401) return { status: "signed_out" };
  const body = (await res.json().catch(() => undefined)) as
    | { viewer?: Viewer; entries?: ActivityEntry[]; nextCursor?: string | null }
    | undefined;
  if (!res.ok || !body?.viewer || !Array.isArray(body.entries)) return { status: "error" };
  return { status: "ok", viewer: body.viewer, entries: body.entries, nextCursor: body.nextCursor ?? null };
}

const VERBS: Record<string, string> = {
  post: "Posted",
  reply: "Replied",
  comment: "Commented",
  poll_answer: "Answered a poll",
  boost: "Boosted",
  unboost: "Undid a boost",
  favourite: "Favourited",
  unfavourite: "Undid a favourite",
  support: "Supported",
  rsvp: "Answered an RSVP",
  withdraw: "Withdrew",
  follow: "Followed",
  unfollow: "Unfollowed",
  delete: "Deleted a post",
};

/** What the member did, in a few words ("Boosted"). */
export function verbLabel(verb: string): string {
  return VERBS[verb] ?? "Acted";
}

/** Who it was done as or where it went: the target's label, else its host. */
export function targetText(entry: ActivityEntry): string {
  return entry.channel === "fediverse"
    ? `as ${entry.targetLabel ?? entry.targetHost}`
    : `at ${entry.targetLabel ?? entry.targetHost}`;
}

/** How it went, in the member's words (ADR-010 §9: messages name the other side). */
export function statusText(entry: ActivityEntry): string {
  switch (entry.status) {
    case "sent":
      return entry.channel === "space" ? `Sent to ${entry.targetHost}` : `Done on ${entry.targetHost}`;
    case "held":
      return `${entry.targetHost} will show it after review`;
    case "undone":
      return "Undone";
    case "unknown":
      return `We couldn't tell whether ${entry.targetHost} got it`;
    case "failed":
      return entry.errorMessage ? `Didn't go. ${entry.targetHost} says: ${entry.errorMessage}` : "Didn't go. Nothing was sent.";
  }
}
