// The identity host's clock. Expiry checks (auth requests, emailed links) and note times all read
// it, and SQL compares against the time passed in, never the database's now(), so tests can move
// time forward. Only the TEST_ROUTES test route can set the offset, and the app refuses to start
// on Vercel with TEST_ROUTES set (env.ts), so production always runs on the real clock.
let offsetMs = 0;

export function identityNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** Test-only (POST /test/clock). */
export function setClockOffset(ms: number): void {
  if (!Number.isFinite(ms)) throw new Error("The clock offset must be a number of milliseconds");
  offsetMs = ms;
}

export function clockOffset(): number {
  return offsetMs;
}
