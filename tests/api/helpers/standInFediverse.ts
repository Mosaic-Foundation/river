// Drives the stand-in fediverse server inside the running dev server (TEST_ROUTES=1 and
// TEST_STAND_IN_FEDIVERSE=1; src/river/acting/fediverse/testRoutes.ts). Its answers are SYNTHETIC
// (tests/support/standInMastodon/).
import type { StandInRequest, StandInRule } from "../../support/standInMastodon/index.js";
import { API } from "./member.js";

const BASE = `${API}/test/stand-in-fediverse`;

async function ok(res: Response): Promise<Response> {
  if (res.status === 404) {
    throw new Error("No stand-in routes: start the dev server with TEST_ROUTES=1 and TEST_STAND_IN_FEDIVERSE=1 in .env (TESTING.md).");
  }
  if (!res.ok) throw new Error(`stand-in route answered ${res.status}: ${await res.text()}`);
  return res;
}

export const standIn = {
  async reset(): Promise<void> {
    await ok(await fetch(`${BASE}/reset`, { method: "POST" }));
  },
  async rules(rules: StandInRule[]): Promise<void> {
    await ok(await fetch(`${BASE}/rules`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(rules) }));
  },
  /** The member approves (or denies) on the server's authorize page; returns where it sends them. */
  async authorize(url: string, username: string, deny = false): Promise<{ location?: string; error?: string }> {
    const res = await ok(
      await fetch(`${BASE}/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, username, deny }),
      }),
    );
    return (await res.json()) as { location?: string; error?: string };
  },
  async revokeAll(): Promise<void> {
    await ok(await fetch(`${BASE}/revoke-all`, { method: "POST" }));
  },
  async requests(): Promise<StandInRequest[]> {
    return (await (await ok(await fetch(`${BASE}/requests`))).json()) as StandInRequest[];
  },
  async tokens(): Promise<string[]> {
    return (await (await ok(await fetch(`${BASE}/tokens`))).json()) as string[];
  },
};
