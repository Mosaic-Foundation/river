// The fixed "now" the Civic Hub fixtures were recorded with (scripts/recorders/civicHub.ts) and the
// tests replay with. Feed URLs carry `since` (now minus 90 days), so the recorder and the tests
// must agree on it exactly or the replayed URLs won't match. Change it only when re-recording.
export const CIVIC_HUB_FIXTURE_NOW = new Date("2026-10-21T00:00:00.000Z");

/** The recorded hubs (spec 6: Demosville, Floyd, Longmont). */
export const CIVIC_HUB_FIXTURE_HOSTS = ["demosville.civic.social", "floyd.civic.social", "longmont.civic.social"] as const;
