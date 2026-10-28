// Posting and replying through a linked fediverse account (fediverse-posting-1.md item 3;
// ADR-010 §4): the API calls, the character counter and the words. No React, so tests/unit/ui/
// covers the counter and the words.

export type Visibility = "public" | "unlisted" | "private";

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: "Public",
  unlisted: "Quiet public",
  private: "Followers only",
};

export interface ComposeAccount {
  id: string;
  handle: string;
  server: string;
  software: "mastodon" | "gotosocial";
  defaultVisibility: Visibility;
  defaultLanguage: string | null;
  limits: { maxCharacters: number; charactersReservedPerUrl: number };
}

export interface ReplyTo {
  itemId: string;
  title: string;
  url: string | null;
  spoilerText: string;
  mention: string | null;
}

export interface ComposeInfo {
  accounts: ComposeAccount[];
  replyTo: ReplyTo | null;
}

export interface PostRequest {
  method: "POST";
  url: string;
  body: { status: string; visibility: Visibility; spoiler_text?: string; in_reply_to_id?: string; language?: string };
}

export interface Preview {
  id: string;
  verb: "post" | "reply";
  as: string;
  server: string;
  request: PostRequest;
  replyTo: { title: string; url: string | null } | null;
  expiresAt: string;
}

export interface SendResult {
  id: string;
  status: "sent" | "failed" | "unknown";
  remoteUrl: string | null;
  error: string | null;
  message: string;
  retryAt: string | null;
  canRetry: boolean;
  checkUrl: string;
}

export interface Refusal {
  error: string;
  message: string;
  retryAt: string | null;
}

export type Answer<T> = { ok: true; body: T } | { ok: false; refusal: Refusal };

const OFFLINE: Refusal = { error: "network", message: "The River didn't answer. Check your connection; nothing was sent.", retryAt: null };

async function call<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  } catch {
    return { ok: false, refusal: OFFLINE };
  }
  const body = (await res.json().catch(() => undefined)) as (T & Partial<Refusal>) | undefined;
  if (res.ok && body !== undefined) return { ok: true, body };
  if (res.status === 401 && !body?.message) {
    return { ok: false, refusal: { error: "signed_out", message: "Your session ended. Sign in again; nothing was sent.", retryAt: null } };
  }
  return {
    ok: false,
    refusal: {
      error: body?.error ?? "error",
      message: typeof body?.message === "string" ? body.message : "That didn't work. Nothing was sent.",
      retryAt: body?.retryAt ?? null,
    },
  };
}

export function loadCompose(replyTo?: string): Promise<Answer<ComposeInfo>> {
  return call<ComposeInfo>(`/api/acts/fediverse/compose${replyTo ? `?replyTo=${encodeURIComponent(replyTo)}` : ""}`);
}

export function previewPost(fields: {
  linkedAccountId: string;
  text: string;
  spoilerText: string;
  visibility: Visibility;
  language: string | null;
  replyToItemId: string | null;
}): Promise<Answer<Preview>> {
  return call<Preview>("/api/acts/fediverse/preview", {
    method: "POST",
    body: JSON.stringify({
      linkedAccountId: fields.linkedAccountId,
      text: fields.text,
      visibility: fields.visibility,
      ...(fields.spoilerText.trim() ? { spoilerText: fields.spoilerText } : {}),
      ...(fields.language ? { language: fields.language } : {}),
      ...(fields.replyToItemId ? { replyToItemId: fields.replyToItemId } : {}),
    }),
  });
}

export function sendPost(id: string): Promise<Answer<SendResult>> {
  return call<SendResult>(`/api/acts/${encodeURIComponent(id)}/send`, { method: "POST" });
}

export function retryPost(id: string): Promise<Answer<SendResult>> {
  return call<SendResult>(`/api/acts/${encodeURIComponent(id)}/retry`, { method: "POST" });
}

/**
 * Characters as the server counts them (item 3.1): on Mastodon a link counts as
 * `charactersReservedPerUrl` and a mention `@user@domain` as `@user`; elsewhere plain characters.
 * The content warning counts too. The server has the last word (a 422).
 */
export function characterCount(text: string, spoiler: string, account: Pick<ComposeAccount, "software" | "limits">): number {
  const plain = (s: string) => Array.from(s).length;
  if (account.software !== "mastodon") return plain(text) + plain(spoiler);
  const urls = text.replace(/https?:\/\/\S+/g, "x".repeat(account.limits.charactersReservedPerUrl));
  const mentions = urls.replace(/(@[a-z0-9_]+)@[a-z0-9.-]+\.[a-z]+/gi, "$1");
  return plain(mentions) + plain(spoiler);
}

/** The reply's starting text: the mention, then a space. */
export function replyStart(replyTo: ReplyTo | null): string {
  return replyTo?.mention ? `${replyTo.mention} ` : "";
}

/** The exact request, as the preview's "Show exactly what will be sent" shows it. */
export function requestText(request: PostRequest): string {
  return `${request.method} ${request.url}\n${JSON.stringify(request.body, null, 2)}`;
}

/** A refusal's words, with its time in the member's own clock when it has one. */
export function refusalText(refusal: Pick<Refusal, "error" | "message" | "retryAt">, now = new Date()): string {
  if (!refusal.retryAt) return refusal.message;
  const at = new Date(refusal.retryAt);
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const when = sameDay ? time : `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
  if (refusal.error === "limit") return `You've sent a lot from the River in the last hour. Try again after ${when}.`;
  return refusal.message.replace(/ asks you to wait\.$/, ` asks you to wait until ${when}.`);
}
