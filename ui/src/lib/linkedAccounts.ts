// Settings → Linked accounts (fediverse-posting-1.md items 1 and 2; ADR-010 §3, §6): the API calls
// and the words. No React, so tests/unit/ui/ covers the words. Every value from a server (names,
// handles, messages) is shown as text by the page.
import type { Viewer } from "./api";

export interface LinkedAccount {
  id: string;
  handle: string;
  server: string;
  displayName: string | null;
  avatarUrl: string | null;
  software: string | null;
  scopes: string[];
  status: "active" | "revoked" | "lapsed";
  linkedAt: string;
  lastUsedAt: string | null;
}

/** A member may link up to this many accounts (item 1.1). */
export const MAX_LINKED = 3;

export type LinkedAccountsResult =
  | { status: "ok"; viewer: Viewer; accounts: LinkedAccount[] }
  | { status: "signed_out" }
  | { status: "error" };

export async function loadLinkedAccounts(signal?: AbortSignal): Promise<LinkedAccountsResult> {
  let res: Response;
  try {
    res = await fetch("/api/linked-accounts", { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { status: "error" };
  }
  if (res.status === 401) return { status: "signed_out" };
  const body = (await res.json().catch(() => undefined)) as { viewer?: Viewer; accounts?: LinkedAccount[] } | undefined;
  if (!res.ok || !body?.viewer || !Array.isArray(body.accounts)) return { status: "error" };
  return { status: "ok", viewer: body.viewer, accounts: body.accounts };
}

const FALLBACK = "Something went wrong. Try again in a few minutes.";

/** A POST to the linking API: its JSON body, or the server's sentence. */
async function post<T>(path: string, body?: unknown): Promise<{ ok: true; body: T } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "The River didn't answer. Check your connection and try again." };
  }
  const json = (await res.json().catch(() => undefined)) as (T & { message?: unknown }) | undefined;
  if (res.status === 401) return { ok: false, message: "Your session ended. Sign in again, then link the account." };
  if (!res.ok || json === undefined) {
    return { ok: false, message: typeof json?.message === "string" ? json.message : FALLBACK };
  }
  return { ok: true, body: json };
}

export interface CheckedServer {
  handle: string;
  server: string;
  software: string;
  maxCharacters: number;
}

/** "Check": finds the server and says whether the River can link with it. */
export function checkAccount(input: string) {
  return post<CheckedServer>("/api/linked-accounts/fediverse/check", { input });
}

/** "Continue to {server}": the URL of the server's own authorize page. */
export function startLink(input: string) {
  return post<{ authorizeUrl: string }>("/api/linked-accounts/fediverse/start", { input });
}

export function unlinkAccount(id: string) {
  return post<{ handle: string; server: string; revokedThere: boolean }>(`/api/linked-accounts/${encodeURIComponent(id)}/unlink`);
}

/** What the River will be able to do, as item 1.3 says it (and ADR-010 §3 lists it again on the account). */
export const VERBS_SENTENCE =
  "post and reply, boost, favourite, follow and unfollow, and delete posts you make from the River";

/** The explainer before the member goes to their server (item 1.3). */
export function explainer(handle: string): string[] {
  return [
    `Mosaic River will be able to post and reply as ${handle}, boost, favourite, follow and unfollow, and delete posts you make from the River.`,
    "It can't read your messages or change your profile. You'll see each post before it's sent. You can unlink at any time.",
  ];
}

/** The callback's result (`?link=`), in words; undefined for anything else. */
export function linkResultMessage(result: string | null): { text: string; ok: boolean } | undefined {
  switch (result) {
    case "linked":
      return { ok: true, text: "Your account is linked." };
    case "denied":
      return { ok: false, text: "Your server didn't allow the River, so nothing was linked." };
    case "expired":
      return { ok: false, text: "That link attempt expired or was started in another tab. Start again." };
    case "different_account":
      return { ok: false, text: "That's a different account from the one you named. Nothing was linked." };
    case "too_many":
      return { ok: false, text: `You've linked ${MAX_LINKED} accounts, the most the River allows. Unlink one to link another.` };
    case "busy":
      return { ok: false, text: "Your server is busy; try again in a few minutes." };
    case "unreachable":
      return { ok: false, text: "We couldn't reach your server. Nothing was linked; try again in a few minutes." };
    case "failed":
      return { ok: false, text: "Your server didn't finish linking. Nothing was linked; try again." };
    case "signed_out":
      return { ok: false, text: "Sign in, then link the account again." };
    default:
      return undefined;
  }
}

/** After unlinking (ADR-010 §6). */
export function unlinkedMessage(result: { handle: string; server: string; revokedThere: boolean }): string {
  return result.revokedThere
    ? `${result.handle} is unlinked, and ${result.server} has forgotten the River's key.`
    : `We've forgotten the key to ${result.handle}. To be sure, also remove Mosaic River from ${result.server}'s authorized apps.`;
}

/** A line under a link that can't act any more. */
export function statusNote(account: LinkedAccount): string | undefined {
  if (account.status === "revoked") return `Your link to ${account.handle} stopped working. Link it again.`;
  if (account.status === "lapsed") return "Unused for 180 days, so the River forgot its key. Link it again to use it.";
  return undefined;
}
