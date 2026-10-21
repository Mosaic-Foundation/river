// What the follow box does with what was typed (spec F6, 4.2, 4.3): find the adapter, resolve the
// address through the fetch guard, and describe the result for the preview (name, icon, kind).
//
// Order (DECISIONS.md, M3 follow-up): the adapters are tried in registry order, the Civic Hub
// adapter first for URLs. When it says the address isn't a hub ("That address isn't a Space we can
// follow") and the next adapter also takes the input (a fediverse profile URL such as
// https://server/users/name, or any https URL for the feed adapter, which comes last), that one is
// tried. Any other failure is the answer.
import { getFetchGuard, type FetchGuard } from "../../shared/fetch/index.js";
import {
  AdapterError,
  ADAPTER_MESSAGES,
  type Adapter,
  type SpaceCategory,
  type SpacePreview,
} from "../../shared/items/index.js";
import { toPlainText } from "../../shared/sanitize/index.js";
import { ADAPTER_REGISTRY, adaptersFor, resolveWith } from "../adapters/index.js";
import { riverNow } from "../clock.js";

/** Longest input the box takes; anything longer isn't an address. */
export const MAX_INPUT = 500;

export interface ResolveDeps {
  guard?: FetchGuard;
  now?: Date;
  adapters?: readonly Adapter[];
}

/** Resolves a follow-box input to a preview, or throws an AdapterError with the F6 wording. */
export async function resolveInput(input: string, deps: ResolveDeps = {}): Promise<SpacePreview> {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text || text.length > MAX_INPUT) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  const candidates = adaptersFor(text, deps.adapters ?? ADAPTER_REGISTRY);
  return resolveWith(candidates, text, { guard: deps.guard ?? getFetchGuard(), now: deps.now ?? riverNow() });
}

/** The follow box's sentence for a failure: exactly one of spec F6's four (or "not supported"). */
export function followErrorMessage(err: unknown): { reason: AdapterError["reason"]; message: string } {
  const reason = err instanceof AdapterError ? err.reason : "unreachable";
  return { reason, message: ADAPTER_MESSAGES[reason] };
}

const NETWORK_NAMES: Record<string, string> = {
  mastodon: "Mastodon",
  wordpress: "WordPress",
  pixelfed: "Pixelfed",
  peertube: "PeerTube",
  misskey: "Misskey",
  lemmy: "Lemmy",
  friendica: "Friendica",
  pleroma: "Pleroma",
  akkoma: "Akkoma",
  gotosocial: "GoToSocial",
  bonfire: "Bonfire",
};

/** The kind label the preview and the Following page show (spec F6 "name, icon and kind"). */
export function kindLabel(adapter: string, network: string | null | undefined, category?: string | null): string {
  if (adapter === "civic_hub") return "Civic Hub";
  if (adapter === "sample") return "Sample entries";
  if (adapter === "fediverse") {
    const key = (network ?? "").toLowerCase();
    if (key === "peertube" && category === "video") return "PeerTube channel";
    return `${NETWORK_NAMES[key] ?? "Fediverse"} account`;
  }
  if (adapter === "rss") {
    if (category === "podcast") return "Podcast feed";
    return network === "atom" ? "Atom feed" : "RSS feed";
  }
  return "Space";
}

/** How a space is written on the Following page: a hub's host, an account's handle. */
export function addressOf(space: {
  adapter: string;
  canonical_url?: string;
  canonicalUrl?: string;
  manifest?: Record<string, unknown> | null;
  home_url?: string | null;
}): string {
  const canonical = space.canonical_url ?? space.canonicalUrl ?? "";
  if (space.adapter === "sample") return "Sample entries";
  if (space.adapter === "fediverse") {
    const actor = (space.manifest?.actor ?? undefined) as { handle?: unknown } | undefined;
    if (typeof actor?.handle === "string") return actor.handle;
  }
  try {
    return new URL(canonical).host;
  } catch {
    return canonical;
  }
}

/** What the follow box shows before confirming. Built from the preview; never from raw HTML. */
export interface PreviewView {
  adapter: string;
  name: string;
  /** Null: the UI draws initials of the name. */
  iconUrl: string | null;
  kind: string;
  category: SpaceCategory | null;
  address: string;
  canonicalUrl: string;
  /** Set when the address pointed at one hub process (spec F6 "Just this stream"). */
  stream: { key: string; title: string | null } | null;
}

/** Only https icons reach the page (spec 4.8; the CSP allows img-src https:). */
function httpsOnly(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function previewView(preview: SpacePreview): PreviewView {
  return {
    adapter: preview.adapter,
    name: toPlainText(preview.name).slice(0, 200) || preview.canonicalUrl,
    iconUrl: httpsOnly(preview.iconUrl),
    kind: kindLabel(preview.adapter, preview.network, preview.category),
    category: preview.category ?? null,
    address: addressOf({ adapter: preview.adapter, canonicalUrl: preview.canonicalUrl, manifest: preview.manifest }),
    canonicalUrl: preview.canonicalUrl,
    stream: preview.stream ? { key: preview.stream.key, title: preview.stream.title ?? null } : null,
  };
}
