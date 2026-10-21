// Pure helpers for cards (spec F1, 4.8). No React, no DOM: tests/unit/ui/ covers them.
import type { ItemKind, MediaRef } from "./api";

/** Content-type filters (spec F5), in order; `value` is what /api/feed's `type` accepts. */
export const CONTENT_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "posts", label: "Posts" },
  { value: "articles", label: "Articles" },
  { value: "podcasts", label: "Podcasts" },
  { value: "videos", label: "Videos" },
  { value: "photos", label: "Photos" },
  { value: "events", label: "Events" },
  { value: "civic", label: "Civic activity" },
];

const KIND_LABELS: Record<ItemKind, string> = {
  post: "Post",
  article: "Article",
  podcast: "Podcast",
  video: "Video",
  photo: "Photo",
  event: "Event",
  civic: "Civic activity",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as ItemKind] ?? "Post";
}

/** The F1 explainer behind every Sample label. Exact text; check 3 compares it. */
export const SAMPLE_EXPLAINER =
  "This isn't linked to a real feed. It's here to show how the River works for a soccer club, a family or a podcast.";

/** The item URL's host for "Open on {host}"; undefined for anything that isn't https. */
export function linkHost(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Spec 4.8 and Appendix B (img-src 'self' https:): an image loads straight from its source over
 * https, or from the River's own sample placeholders. Anything else is not shown.
 */
export function safeImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^\/samples\/[A-Za-z0-9._-]+$/.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/** The images a card shows: image media with a usable URL, at most `limit`. */
export function cardImages(media: readonly MediaRef[] | null | undefined, limit = 4): MediaRef[] {
  return (media ?? [])
    .filter((m) => m && m.type === "image" && safeImageUrl(m.url))
    .slice(0, limit);
}

/** Up to two letters for an initials icon: the first letters of the first two words. */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago", "yesterday", "in 2 days"; "just now" under a minute. */
export function relativeTime(iso: string, now: number = Date.now(), locale = "en"): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const seconds = Math.round((at - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (abs >= size) return format.format(Math.trunc(seconds / size), unit);
  }
  return "just now";
}

/** A full date and time for the `title` of a relative time. */
export function fullDateTime(iso: string, locale = "en"): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** "38 min" for a podcast, "6:12" for a video; "1 h 5 min" past an hour. */
export function formatDuration(seconds: number | undefined, kind: string): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  if (kind === "video") return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  return `${Math.max(1, Math.round(total / 60))} min`;
}

/** An event's start as "Mon, Oct 26, 3:44 AM", and its month and day for the date badge. */
export function eventDate(iso: string | undefined, locale = "en"):
  | { label: string; month: string; day: string; dateTime: string }
  | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  return {
    label: at.toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    month: at.toLocaleString(locale, { month: "short" }),
    day: String(at.getDate()),
    dateTime: at.toISOString(),
  };
}

/** "Open until Oct 28" for a civic deadline. */
export function deadlineLabel(iso: string | undefined, locale = "en"): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  return `Open until ${at.toLocaleDateString(locale, { month: "short", day: "numeric" })}`;
}

/** A circle's color from the API, only when it is a plain hex color (it ends up in a CSS value). */
export function circleColor(color: string | null | undefined): string | undefined {
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined;
}
