// The follow box, the Following page and circles (spec F6, F7, F8): calls to the River's own API
// (members only; same origin, so the CSP's connect-src 'self' holds). Shapes match
// src/river/following/ (DECISIONS.md "Following API").

export interface Preview {
  adapter: string;
  name: string;
  /** Null: draw the name's initials. */
  iconUrl: string | null;
  /** The account's bio (Bluesky), plain text; null when there is none. */
  description: string | null;
  kind: string;
  category: string | null;
  address: string;
  canonicalUrl: string;
  /** Set when the address points at one hub process. */
  stream: { key: string; title: string | null } | null;
}

export type Rule = "follow" | "mute";

export interface StreamView {
  id: string;
  key: string;
  title: string;
  status: "open" | "ended";
  rule: Rule | null;
  ruleId: string | null;
}

export interface SpaceView {
  id: string;
  name: string;
  iconUrl: string | null;
  adapter: string;
  category: string | null;
  kind: string;
  address: string;
  following: boolean;
  ruleId: string | null;
  quiet: boolean;
  newestItemAt: string | null;
  lastError: string | null;
  circleIds: string[];
  streams: StreamView[];
}

export interface EndedView {
  ruleId: string;
  rule: Rule;
  endedAt: string;
  space: { id: string; name: string; iconUrl: string | null; adapter: string; address: string };
  stream: { id: string; key: string; title: string };
}

export interface CircleView {
  id: string;
  name: string;
  color: string | null;
  role: "civic" | null;
  spaceIds: string[];
}

export interface FollowingPage {
  spaces: SpaceView[];
  quiet: string[];
  ended: EndedView[];
  circles: CircleView[];
}

/** What a call answered: ok with its body, or the sentence to show. */
export type Result<T> = { ok: true; value: T } | { ok: false; message: string; status: number };

const FALLBACK = "That didn't work. Try again in a moment.";

async function request<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers:
        body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: "We couldn't reach the River. Check your connection and try again." };
  }
  if (res.status === 204) return { ok: true, value: undefined as T };
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = (json as { message?: unknown } | undefined)?.message;
    return { ok: false, status: res.status, message: typeof message === "string" ? message : FALLBACK };
  }
  return { ok: true, value: json as T };
}

export const previewFollow = (input: string) => request<{ preview: Preview }>("POST", "/follow/preview", { input });

export const confirmFollow = (input: string, scope: "space" | "stream", circleIds: string[]) =>
  request<{ spaceId: string; streamId: string | null }>("POST", "/follows", { input, scope, circleIds });

/** "Import from Bluesky": the account and who it follows (docs/spec/bluesky-1.md item 4). */
export interface ImportPreview {
  account: { did: string; name: string; handle: string | null; iconUrl: string | null };
  /** Accounts it follows that the River can follow. */
  count: number;
  /** Accounts left out because they hide from signed-out readers. */
  skipped: number;
  /** True when it follows more than the River reads in one import (1,000). */
  truncated: boolean;
  /** The first few, for the preview. */
  accounts: Array<{ did: string; name: string; handle: string | null; iconUrl: string | null }>;
}

export interface ImportResult {
  total: number;
  followed: number;
  alreadyFollowing: number;
  skipped: number;
  truncated: boolean;
}

export const previewBlueskyImport = (input: string) => request<ImportPreview>("POST", "/follow/bluesky/preview", { input });

export const importBluesky = (input: string, circleIds: string[]) =>
  request<ImportResult>("POST", "/follow/bluesky/import", { input, circleIds });

function accountsCount(n: number): string {
  return n === 1 ? "1 account" : `${n.toLocaleString("en-US")} accounts`;
}

/** "@eff.org follows 263 accounts." with what was left out. */
export function importCountSentence(preview: ImportPreview): string {
  const who = preview.account.handle ? `@${preview.account.handle}` : preview.account.name;
  const parts = [`${who} follows ${accountsCount(preview.count)}${preview.truncated ? " (the first 1,000 are listed)" : ""}.`];
  if (preview.skipped > 0) {
    parts.push(`Left out: ${accountsCount(preview.skipped)} that show only to people signed in to Bluesky.`);
  }
  return parts.join(" ");
}

/** "You're now following 250 more accounts (13 you already followed), in Friends. …" */
export function importDoneSentence(result: ImportResult, circle: string | null): string {
  const already = result.alreadyFollowing > 0 ? ` (${result.alreadyFollowing.toLocaleString("en-US")} you already followed)` : "";
  const where = circle ? `, in ${circle}` : "";
  const n = result.followed;
  const more = n === 1 ? "1 more account" : `${n.toLocaleString("en-US")} more accounts`;
  return `You're now following ${more}${already}${where}. Their posts fill in over your next visits.`;
}

export const loadFollowing = () => request<FollowingPage>("GET", "/following");

export const unfollowSpace = (spaceId: string) => request<void>("DELETE", `/following/spaces/${spaceId}`);

export const setStreamRule = (streamId: string, rule: Rule) =>
  request<{ ruleId: string }>("PUT", `/following/streams/${streamId}`, { rule });

export const removeRule = (ruleId: string) => request<void>("DELETE", `/following/rules/${ruleId}`);

export const unfollowQuiet = () => request<{ unfollowed: string[] }>("POST", "/following/quiet/unfollow");

export const createCircle = (name: string, color: string) =>
  request<{ circle: CircleView }>("POST", "/circles", { name, color });

export const updateCircle = (id: string, change: { name?: string; color?: string }) =>
  request<{ circle: CircleView }>("PATCH", `/circles/${id}`, change);

export const deleteCircle = (id: string) => request<void>("DELETE", `/circles/${id}`);

export const addToCircle = (id: string, spaceId: string) => request<void>("PUT", `/circles/${id}/spaces/${spaceId}`);

export const removeFromCircle = (id: string, spaceId: string) => request<void>("DELETE", `/circles/${id}/spaces/${spaceId}`);

/** Circle colors to choose from (the seed circles' five, then a few more). User data, not theme. */
export const CIRCLE_COLORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "#2F6FA8", label: "Blue" },
  { value: "#7A5AA6", label: "Purple" },
  { value: "#C2603A", label: "Orange" },
  { value: "#3C8A4E", label: "Green" },
  { value: "#A8862C", label: "Gold" },
  { value: "#8C1D26", label: "Red" },
  { value: "#14335F", label: "Navy" },
  { value: "#5B6270", label: "Slate" },
];

/** The Following page's groups (spec F7 "grouped by kind"), in order. */
export const GROUPS: ReadonlyArray<{ adapter: string; title: string }> = [
  { adapter: "civic_hub", title: "Civic Hubs" },
  { adapter: "fediverse", title: "Fediverse" },
  { adapter: "atproto", title: "Bluesky" },
  { adapter: "rss", title: "Feeds and podcasts" },
  { adapter: "sample", title: "Samples" },
];

/** Groups spaces by kind; anything unknown goes last under "Other". */
export function groupSpaces(spaces: readonly SpaceView[]): Array<{ title: string; spaces: SpaceView[] }> {
  const known = GROUPS.map((g) => ({ title: g.title, spaces: spaces.filter((s) => s.adapter === g.adapter) }));
  const other = spaces.filter((s) => !GROUPS.some((g) => g.adapter === s.adapter));
  return [...known, { title: "Other", spaces: other }].filter((g) => g.spaces.length > 0);
}

/** "2 spaces have posted nothing in 90 days." */
export function quietSentence(count: number): string {
  return count === 1 ? "1 space has posted nothing in 90 days." : `${count} spaces have posted nothing in 90 days.`;
}

/** "3 spaces" */
export function spacesCount(count: number): string {
  return count === 1 ? "1 space" : `${count} spaces`;
}
