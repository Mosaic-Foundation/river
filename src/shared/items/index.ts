// The one item shape every source becomes (spec 3.1, 4.1, ADR-003), and the adapter contract.
//
// Adapters are pure with respect to storage: they fetch through the FetchGuard they are given and
// return items plus the space and stream changes they observed. The refresh (M5) writes them,
// inside forInstance(), as each page arrives (onPage), deduping on (space_id, source_id).
import type { FetchGuard } from "../fetch/index.js";

export const ITEM_KINDS = ["post", "article", "podcast", "video", "photo", "event", "civic"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ADAPTERS = ["civic_hub", "fediverse", "sample", "rep_space_v01", "atproto"] as const;
export type AdapterName = (typeof ADAPTERS)[number];

export const SPACE_CATEGORIES = [
  "civic", "news", "publication", "club", "family", "neighborhood", "podcast", "video", "person", "organization",
] as const;
export type SpaceCategory = (typeof SPACE_CATEGORIES)[number];

/** items.media entries. */
export interface MediaRef {
  type: "image" | "video" | "audio";
  url: string;
  alt?: string;
  /** Seconds. */
  duration?: number;
  width?: number;
  height?: number;
}

/** items.author. */
export interface ItemAuthor {
  name?: string;
  /** e.g. @name@server */
  handle?: string;
  url?: string;
  iconUrl?: string;
}

/** items.boost_of: what was boosted, enough for a boost card without dereferencing it. */
export interface BoostRef {
  /** The boosted object's IRI. */
  objectId: string;
  /** Host the boosted post lives on ("boosted a post from {host}"). */
  host: string;
  url?: string;
  author?: ItemAuthor;
}

/** items.civic. */
export interface CivicDetails {
  activityType: string;
  objectType: string;
  processType?: string;
  /** The stream key, https://{host}/process/{id}. */
  processIri?: string;
  /** e.g. "ended", "closed", "archived". */
  terminalState?: string;
  placeCode?: string;
  /** ISO 8601. */
  deadline?: string;
}

/** One item, before it is stored. Field names follow items columns in camelCase. */
export interface NormalizedItem {
  sourceId: string;
  kind: ItemKind;
  publishedAt: Date;
  title?: string;
  summary?: string;
  /** Already sanitized (src/shared/sanitize/). */
  contentHtml?: string;
  /** Null for samples. */
  url?: string;
  streamKey?: string;
  author?: ItemAuthor;
  media: MediaRef[];
  boostOf?: BoostRef;
  civic?: CivicDetails;
  isFinalResult: boolean;
  /** Stored but never shown: closed-by-default hub activities, replies, non-public items. */
  hidden: boolean;
  /** The source object as received, for reprocessing. */
  raw: unknown;
}

/** What a follow box shows before confirming (spec F6). */
export interface SpacePreview {
  adapter: AdapterName;
  canonicalUrl: string;
  name: string;
  /** Null means the UI draws initials of `name`. */
  iconUrl?: string;
  homeUrl?: string;
  feedUrl?: string;
  actorId?: string;
  network?: string;
  category?: SpaceCategory;
  /** spaces.manifest: adapter-specific cache (e.g. the actor, with expiresAt). */
  manifest: Record<string, unknown>;
  /** Set when the input pointed at one stream (a hub process). */
  stream?: { key: string; title?: string };
}

/** The stored space an adapter refreshes: the columns it reads. */
export interface SpaceRecord {
  id: string;
  adapter: AdapterName;
  canonicalUrl: string;
  feedUrl?: string | null;
  actorId?: string | null;
  network?: string | null;
  manifest: Record<string, unknown>;
  etag?: string | null;
  etagUrl?: string | null;
  newestItemAt?: Date | null;
}

/** A change to a stream the adapter observed (spec 4.2 stream end). */
export interface StreamUpdate {
  key: string;
  title?: string;
  status?: "open" | "ended";
  endedAt?: Date;
  /** sourceId of the item to mark is_final_result. */
  finalItemSourceId?: string;
}

export interface FetchContext {
  guard: FetchGuard;
  now: Date;
  /** source_ids already stored for this space (fediverse stops at the first known one). */
  isKnown?: (sourceId: string) => boolean | Promise<boolean>;
  /** Called with each page's items as it arrives, so a slow source keeps what it got. */
  onPage?: (items: NormalizedItem[]) => void | Promise<void>;
}

export interface FetchResult {
  items: NormalizedItem[];
  /** Column changes for the space (etag, etag_url, newest_item_at, manifest, fetch_status...). */
  space: Partial<Pick<SpaceRecord, "etag" | "etagUrl" | "newestItemAt" | "manifest">> & {
    fetchStatus?: "ok" | "error" | "blocked";
    lastError?: string | null;
  };
  streams: StreamUpdate[];
  /** A 304: nothing changed, existing items stay. */
  notModified: boolean;
}

/** Why an adapter could not resolve or read a source, in the follow box's terms (spec F6). */
export class AdapterError extends Error {
  constructor(
    readonly reason: "unreachable" | "not_a_space" | "refused" | "server_only" | "not_supported",
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

/** The follow box's sentence for each reason (spec F6, 4.3). */
export const ADAPTER_MESSAGES: Record<AdapterError["reason"], string> = {
  unreachable: "We couldn't reach that address",
  not_a_space: "That address isn't a Space we can follow",
  refused: "This address can't be followed",
  server_only: "This server only shares posts with other servers",
  not_supported: "That kind of Space isn't supported yet",
};

export interface Adapter {
  name: AdapterName;
  /** True if this adapter is the one to try for what was typed in the follow box. */
  accepts(input: string): boolean;
  resolve(input: string, ctx: Pick<FetchContext, "guard" | "now">): Promise<SpacePreview>;
  fetchNew(space: SpaceRecord, ctx: FetchContext): Promise<FetchResult>;
}
