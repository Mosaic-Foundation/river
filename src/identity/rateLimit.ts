// Fixed-window rate limits per key (spec 4.6: /authorize and sign-up per IP; recovery per IP, and
// per IP and address together, so a stranger can't use up someone else's recovery). Kept in the function instance's memory: on Vercel each warm instance counts on
// its own, which slows a single client but is no global cap (DECISIONS, M7). Recovery emails also
// have a durable per-person cap in the database (src/identity/flows/recover.ts).
export interface Limit {
  max: number;
  windowMs: number;
}

export const LIMITS = {
  /** GET /authorize, and both sign-in steps. */
  authorize: { max: 60, windowMs: 10 * 60_000 },
  /** Sign-up options (a new person and DID each). */
  signup: { max: 10, windowMs: 60 * 60_000 },
  /** "Lost your passkey?" per IP. */
  recoverIp: { max: 10, windowMs: 15 * 60_000 },
  /** "Lost your passkey?" per IP and address together (hashed), known or not. */
  recoverAddress: { max: 3, windowMs: 60 * 60_000 },
  /** Emailed links and the change-email ceremony. */
  links: { max: 60, windowMs: 10 * 60_000 },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

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
