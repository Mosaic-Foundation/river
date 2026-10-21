// Small readers for ActivityStreams 2.0 JSON as servers really send it: a property can be a
// string, an object or an array of either, and any of them can be missing. Nothing here fetches.

/** A parsed JSON object (AS2 objects are open-ended, so values are unknown until checked). */
export type AsObject = Record<string, unknown>;

/** What the adapter sends as Accept for ActivityPub reads (spec 4.3). */
export const ACTIVITY_JSON = "application/activity+json";
/** The other content type ActivityPub allows for actors and objects. */
export const LD_JSON_AS = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"';
/** Accept for WebFinger (RFC 7033) and NodeInfo. */
export const JRD_JSON = "application/jrd+json, application/json";
export const PLAIN_JSON = "application/json";

/** The three spellings of the public collection (ActivityPub 5.6). */
export const PUBLIC_IRIS: ReadonlySet<string> = new Set([
  "https://www.w3.org/ns/activitystreams#Public",
  "as:Public",
  "Public",
]);

export function isObject(value: unknown): value is AsObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A property as a list: missing is [], one value is [value]. */
export function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The id of a value that is either an IRI string or an object with `id`. */
export function idOf(value: unknown): string | undefined {
  if (typeof value === "string") return str(value);
  if (isObject(value)) return str(value.id);
  return undefined;
}

/** The type of an object; with several types (allowed by AS2), the first. */
export function typeOf(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;
  const t = value.type;
  return typeof t === "string" ? t : str(asList(t)[0]);
}

/** True when `to` names the public collection in any of its spellings. */
export function addressedToPublic(to: unknown): boolean {
  return asList(to).some((entry) => {
    const id = idOf(entry);
    return id !== undefined && PUBLIC_IRIS.has(id);
  });
}

/**
 * The first usable https URL in a `url`-style property: a string, a Link (`href`), or a list of
 * those, preferring an entry with `preferMediaType` (e.g. "text/html") when there is one.
 */
export function urlOf(value: unknown, preferMediaType?: string): string | undefined {
  const candidates: Array<{ href: string; mediaType?: string }> = [];
  for (const entry of asList(value)) {
    if (typeof entry === "string") {
      if (httpsUrl(entry)) candidates.push({ href: entry });
    } else if (isObject(entry)) {
      const href = str(entry.href) ?? str(entry.url) ?? str(entry.id);
      if (href && httpsUrl(href)) candidates.push({ href, mediaType: str(entry.mediaType) });
    }
  }
  if (preferMediaType) {
    const preferred = candidates.find((c) => c.mediaType?.startsWith(preferMediaType));
    if (preferred) return preferred.href;
  }
  return candidates[0]?.href;
}

/** The URL if it parses as https://, else undefined. */
export function httpsUrl(value: unknown): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  try {
    return new URL(s).protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}

/** The host of an https IRI, lowercased; undefined for anything else. */
export function hostOf(iri: string | undefined): string | undefined {
  if (!iri) return undefined;
  try {
    const url = new URL(iri);
    return url.protocol === "https:" ? url.host.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** A date from an ISO 8601 string, or undefined. */
export function dateOf(value: unknown): Date | undefined {
  const s = str(value);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Seconds from an xsd:duration such as "PT1H2M3S" (PeerTube, Funkwhale), or undefined. */
export function durationSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = str(value);
  if (!s) return undefined;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s);
  if (!m || s === "P" || s.endsWith("T")) return undefined;
  const [, d, h, min, sec] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(sec ?? 0);
}

/** Actor types the River reads, and the space category each becomes (spec 4.3). */
export const ACTOR_CATEGORY: Readonly<Record<string, "person" | "organization">> = {
  Person: "person",
  Organization: "organization",
  Group: "organization",
  Service: "organization",
  Application: "organization",
};
