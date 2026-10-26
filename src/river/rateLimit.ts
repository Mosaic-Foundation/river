// Fixed-window rate limits for the River's costly requests, per key (an account id here). Like the
// identity host's (src/identity/rateLimit.ts; the two never import each other, constraint 7), they
// are kept in the function instance's memory: on Vercel each warm instance counts on its own,
// which slows one member down but is no global cap (DECISIONS, M7).
import type { NextFunction, Request, Response } from "express";

export interface Limit {
  max: number;
  windowMs: number;
}

export const LIMITS = {
  /** "Import from Bluesky" preview: up to 10 AppView pages each. */
  blueskyPreview: { max: 20, windowMs: 10 * 60_000 },
  /** "Import from Bluesky" import: the same pages again, then up to 1,000 follows stored. */
  blueskyImport: { max: 10, windowMs: 60 * 60_000 },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

export const TOO_MANY = "You've done that a lot just now. Wait a few minutes, then try again.";

interface Window {
  start: number;
  count: number;
}

const windows = new Map<string, Window>();
let lastSweep = 0;

/** Counts one hit; returns false once the key is over its limit for the current window. */
export function hit(name: LimitName, key: string, now = Date.now()): boolean {
  const limit: Limit = LIMITS[name];
  sweep(now);
  const id = `${name}:${key}`;
  const current = windows.get(id);
  if (!current || now - current.start >= limit.windowMs) {
    windows.set(id, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit.max;
}

/** Unit tests. */
export function resetRateLimits(): void {
  windows.clear();
}

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  const longest = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));
  for (const [id, window] of windows) {
    if (now - window.start >= longest) windows.delete(id);
  }
}

/**
 * Middleware: counts a hit against `name` for the key `keyOf` gives (after requireMember(), the
 * account), and answers 429 with a sentence to show once it is over the limit.
 */
export function limitBy(name: LimitName, keyOf: (res: Response) => string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (hit(name, keyOf(res))) {
      next();
      return;
    }
    const retryAfter = Math.ceil(LIMITS[name].windowMs / 1000);
    res.status(429).set({ "Retry-After": String(retryAfter), "Cache-Control": "no-store" }).json({ error: "rate_limited", message: TOO_MANY });
  };
}
