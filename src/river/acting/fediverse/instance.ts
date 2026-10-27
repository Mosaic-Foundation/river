// A server's character limit (fediverse-posting-1.md item 3.1), from `/api/v2/instance`, which
// needs no token. Kept in the function instance's memory for an hour per host; any failure gives
// the software's default, since the server has the last word on length anyway (a 422).
import type { FetchGuard } from "../../../shared/fetch/index.js";
import { isObject } from "../../adapters/fediverse/activitypub.js";

export interface ServerLimits {
  maxCharacters: number;
  /** What a link counts as on Mastodon; other software counts plain characters. */
  charactersReservedPerUrl: number;
}

export const DEFAULT_LIMITS: Record<"mastodon" | "gotosocial", ServerLimits> = {
  mastodon: { maxCharacters: 500, charactersReservedPerUrl: 23 },
  gotosocial: { maxCharacters: 5000, charactersReservedPerUrl: 23 },
};

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { limits: ServerLimits; until: number }>();

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000 ? value : undefined;
}

/** The limits in an instance document, falling back to `fallback` field by field. */
export function limitsFrom(body: unknown, fallback: ServerLimits): ServerLimits {
  const configuration = isObject(body) && isObject(body.configuration) ? body.configuration : undefined;
  const statuses = isObject(configuration?.statuses) ? configuration.statuses : undefined;
  return {
    maxCharacters: positiveInt(statuses?.max_characters) ?? fallback.maxCharacters,
    charactersReservedPerUrl: positiveInt(statuses?.characters_reserved_per_url) ?? fallback.charactersReservedPerUrl,
  };
}

export async function readServerLimits(
  guard: FetchGuard,
  host: string,
  software: "mastodon" | "gotosocial",
  now = Date.now(),
): Promise<ServerLimits> {
  const hit = cache.get(host);
  if (hit && hit.until > now) return hit.limits;
  let limits = DEFAULT_LIMITS[software];
  try {
    const res = await guard.fetch(`https://${host}/api/v2/instance`, { headers: { accept: "application/json" } });
    if (res.status === 200) limits = limitsFrom(JSON.parse(await res.text()), limits);
    else await res.body?.cancel();
  } catch {
    // The defaults stand.
  }
  cache.set(host, { limits, until: now + TTL_MS });
  return limits;
}

/** Tests only. */
export function clearServerLimits(): void {
  cache.clear();
}
