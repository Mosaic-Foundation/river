// One hub activity (Civic Activity Spec v0.2, AS2) to one item (spec 4.2 Map, 3.1). Everything
// here came from another server: strings are reduced to plain text or sanitized, URLs must be
// https, and nothing in an activity is ever treated as an instruction.
import type { CivicDetails, NormalizedItem } from "../../../shared/items/index.js";
import { sanitize, toPlainText } from "../../../shared/sanitize/index.js";
import { allowRow } from "./allowlist.js";
import { templateText } from "./hubTemplates.js";

export const AS_PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const PUBLIC_FORMS = new Set([AS_PUBLIC, "as:Public", "Public"]);

/** Longest title kept. */
export const MAX_TITLE = 300;

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** AS2 allows a type to be an array; the hub sends a string. Take the first string either way. */
function typeOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((v): v is string => typeof v === "string");
  return undefined;
}

/** An absolute https URL, or undefined (a link on a card must never be javascript:, http: ...). */
export function httpsUrl(value: unknown): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  try {
    const url = new URL(s);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Addressed to the public (to, cc or audience names as:Public). */
export function isPublic(activity: Json): boolean {
  return [...list(activity.to), ...list(activity.cc), ...list(activity.audience)].some((a) => {
    const id = typeof a === "string" ? a : str(record(a)?.id);
    return id !== undefined && PUBLIC_FORMS.has(id);
  });
}

function plainTitle(value: unknown): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  const plain = toPlainText(s);
  if (!plain) return undefined;
  return plain.length > MAX_TITLE ? `${plain.slice(0, MAX_TITLE - 1)}…` : plain;
}

/** The facts the stream bookkeeping needs, alongside the item. */
export interface MappedActivity {
  item: NormalizedItem;
  activityType: string;
  objectType?: string;
  /** Create civic:Process: the stream's title (spec 3.1 streams.title). */
  streamTitle?: string;
  /** civic:End on the stream's process. */
  endsStream: boolean;
  /** Announce civic:Result or Create civic:Outcome (spec 4.2 stream end). */
  finalCandidate: boolean;
}

/**
 * Maps one activity. Returns undefined for anything that is not stored at all: not addressed to the
 * public (spec 4.2), or missing the id or date every item needs. Activities the allowlist doesn't
 * name come back with hidden = true. `streamTitles` supplies the title for items whose object has
 * no name (spec 4.2: "object.name to title, else the stream's title").
 */
export function mapActivity(raw: unknown, streamTitles: ReadonlyMap<string, string> = new Map()): MappedActivity | undefined {
  const activity = record(raw);
  if (!activity || !isPublic(activity)) return undefined;
  const sourceId = httpsUrl(activity.id);
  const activityType = typeOf(activity.type);
  const published = str(activity.published);
  const publishedAt = published ? new Date(published) : undefined;
  if (!sourceId || !activityType || !publishedAt || Number.isNaN(publishedAt.getTime())) return undefined;

  const object = record(activity.object) ?? {};
  const objectType = typeOf(object.type);
  const context = record(activity.context) ?? {};
  const streamKey = httpsUrl(context.id);
  const processType = str(context["civic:processType"]);
  const payload = record(object["hub:payload"]) ?? {};

  const row = allowRow(activityType, objectType, processType);
  // The hub shows one official-response card per burst of responses (its feed_anchor flag); the
  // others stay on the wire but not in a feed. Closed by default, so only an explicit false hides.
  const unanchored = objectType === "hub:OfficialResponse" && payload.feed_anchor === false;
  const hidden = !row || unanchored;

  const streamTitle =
    activityType === "Create" && objectType === "civic:Process" ? plainTitle(object.name) : undefined;
  const title = plainTitle(object.name) ?? (streamKey ? streamTitles.get(streamKey) : undefined);
  const summary =
    (objectType ? templateText(activityType, objectType, payload) : undefined) ??
    (str(object.summary) ? toPlainText(String(object.summary)) || undefined : undefined);
  const content = str(object.content) ? sanitize(String(object.content)) : "";

  const place = str(record(activity.location)?.["civic:code"]);
  const deadline = str(payload.voting_closes_at) ?? str(record(payload.process)?.voting_closes_at);
  const civic: CivicDetails = {
    activityType,
    objectType: objectType ?? "",
    ...(processType ? { processType } : {}),
    ...(streamKey ? { processIri: streamKey } : {}),
    ...(str(object["civic:terminalState"]) ? { terminalState: String(object["civic:terminalState"]) } : {}),
    ...(place ? { placeCode: place } : {}),
    ...(deadline && !Number.isNaN(new Date(deadline).getTime()) ? { deadline: new Date(deadline).toISOString() } : {}),
    ...(row ? { label: row.label } : {}),
  };

  const url = httpsUrl(activity.url);
  const item: NormalizedItem = {
    sourceId,
    kind: row?.kind ?? "civic",
    publishedAt,
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(content ? { contentHtml: content } : {}),
    ...(url ? { url } : {}),
    ...(streamKey ? { streamKey } : {}),
    media: [],
    civic,
    isFinalResult: false,
    hidden,
    raw: activity,
  };
  return {
    item,
    activityType,
    ...(objectType ? { objectType } : {}),
    ...(streamTitle ? { streamTitle } : {}),
    endsStream: Boolean(row?.endsStream),
    finalCandidate: Boolean(row?.finalCandidate) && !hidden,
  };
}
