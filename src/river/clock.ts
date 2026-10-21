// The River's clock for adapter work (feed URLs carry `since`, the fediverse actor cache expires).
// TEST_CLOCK_NOW fixes it for API and e2e runs so replayed URLs match the recordings; env.ts
// refuses that variable on Vercel. Database time (now() in SQL) is never affected.
import { env } from "../config/env.js";

export function riverNow(): Date {
  const fixed = env.testClockNow;
  return fixed ? new Date(fixed.getTime()) : new Date();
}
