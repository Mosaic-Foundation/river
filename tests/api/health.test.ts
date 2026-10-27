// The keep-alive's requests (.github/workflows/keep-alive.yml): GET /health/db on each app reads
// the database, so a daily request keeps the free Supabase project from pausing. On Vercel the
// River's is /api/health/db (api/index.ts strips /api).
import { describe, expect, it } from "vitest";

const API = process.env.API_URL ?? "http://localhost:3000";
const ID = process.env.IDENTITY_API_URL ?? "http://localhost:3001";

describe.each([
  ["river", API],
  ["identity", ID],
])("%s GET /health/db", (app, base) => {
  it("reads the database and says so, uncached", async () => {
    const res = await fetch(`${base}/health/db`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(await res.json()).toEqual({ ok: true, app, database: true });
  });
});
