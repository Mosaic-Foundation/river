// Fixed-window rate limits for the River's costly requests, per key (an account id, or the caller's
// address for sign-in). Like the
// identity host's (src/identity/rateLimit.ts; the two never import each other, constraint 7), they
// are kept in the function instance's memory: on Vercel each warm instance counts on its own,
// which slows one member down but is no global cap (DECISIONS, M7).
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

export interface Limit {
  max: number;
  windowMs: number;
}

export const LIMITS = {
  /** "Import from Bluesky" preview: up to 10 AppView pages each. */
  blueskyPreview: { max: 20, windowMs: 10 * 60_000 },
  /** "Import from Bluesky" import: the same pages again, then up to 1,000 follows stored. */
  blueskyImport: { max: 10, windowMs: 60 * 60_000 },
  /**
   * Linking a fediverse account, per account: each check or start reads up to five documents from
   * the member's server, and a start may register an app there (fediverse-posting-1 item 1).
   */
  fediverseLink: { max: 30, windowMs: 10 * 60_000 },
  /**
   * Post and reply previews, per account: a reply's preview resolves the post on the member's
   * server (one request), and each stores a row (DECISIONS, A1: "rate-limit the preview route").
   */
  actPreview: { max: 60, windowMs: 10 * 60_000 },
  /** GET /auth/signin per address: each one stores an auth_attempts row. */
  signin: { max: 60, windowMs: 10 * 60_000 },
  /** GET /auth/callback per address: each one can resolve a DID. */
  callback: { max: 60, windowMs: 10 * 60_000 },
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

/** Test-only (POST /test/rate-limits/reset), and unit tests. */
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
 * The caller's address, as the identity host reads it (src/identity/http.ts). On Vercel the
 * platform sets x-real-ip (and the first x-forwarded-for entry) itself; elsewhere a header could
 * be forged, so the socket address is used.
 */
export function clientIp(req: Request): string {
  if (env.onVercel) {
    const real = req.headers["x-real-ip"];
    if (typeof real === "string" && real !== "") return real;
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded !== "") return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** The page an over-limit sign-in shows: no script, no inline style (CSP). */
const TOO_MANY_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Too many sign-in attempts · Mosaic River</title></head>
<body>
<main>
<h1>Too many sign-in attempts</h1>
<p>There have been a lot of sign-ins from here just now. Wait a few minutes, then try again.</p>
<p><a href="/">Go to the River</a></p>
</main>
</body>
</html>
`;

/** Middleware for the sign-in pages: counts a hit against `name` for the caller's address. */
export function limitByIp(name: "signin" | "callback") {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (hit(name, clientIp(req))) {
      next();
      return;
    }
    res
      .status(429)
      .set({ "Retry-After": String(Math.ceil(LIMITS[name].windowMs / 1000)), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" })
      .type("html")
      .send(TOO_MANY_PAGE);
  };
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
