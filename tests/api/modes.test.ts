// Modes and the plugin panel over HTTP (spec F9, 4.7; checks 7 and 8, API part), against the
// running dev server (`npm run dev`, reading .env with FETCH_FIXTURES_DIR and TEST_CLOCK_NOW at the
// hub fixtures' clock), as a visitor. Check 8 needs an instance offering only Civic: this file
// inserts one as postgres under a random hostname (river_app can't write instances), asks for it
// by Host header, and deletes it afterwards.
import { randomUUID } from "node:crypto";
import http from "node:http";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL, SEED_INSTANCE } from "./db/roles.js";

const API = process.env.API_URL ?? "http://localhost:3000";
const CLOCK = "2026-10-21T00:00:00.000Z"; // TEST_CLOCK_NOW in .env
const LONGMONT_DEADLINE = "2026-11-08T05:00:47.238Z"; // recorded hub:payload voting_closes_at

interface DateEntry {
  date: string;
  what: string;
  title: string;
  spaceName: string;
  url: string | null;
}
type Output = { type: "dates"; intro: string; entries: DateEntry[] } | { type: "placeholder"; text: string; waitingOn: string[] };
interface Feed {
  instance: { modes: string[]; defaultMode: string };
  mode: string;
  modes: Array<{ id: string; title: string }>;
  theme: string;
  surfaces: Record<string, Array<{ id: string; title: string; version: string; output: Output }>> | null;
  items: Array<{ space: { category: string | null } }>;
  nextCursor: string | null;
}

function get(path: string, host?: string): Promise<{ status: number; body: string }> {
  const url = new URL(path, API);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: host ? { host } : {} },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function feed(query = "", host?: string): Promise<Feed> {
  const res = await get(`/feed${query}`, host);
  if (res.status !== 200) throw new Error(`GET /feed${query} answered ${res.status}: ${res.body}`);
  return JSON.parse(res.body) as Feed;
}

describe("modes on river.mosaic.social (check 7, API part)", () => {
  it("offers Everything and Civic; Everything wears Mosaic and has Coming up across all follows", async () => {
    const everything = await feed();
    expect(everything.modes).toEqual([
      { id: "everything", title: "Everything" },
      { id: "civic", title: "Civic" },
    ]);
    expect(everything).toMatchObject({ mode: "everything", theme: "mosaic" });
    const panel = everything.surfaces?.["river.panel"] ?? [];
    expect(panel.map((p) => p.id)).toEqual(["coming-up"]);
    const comingUp = panel[0]!.output;
    expect(comingUp.type).toBe("dates");
    if (comingUp.type !== "dates") return;
    expect(comingUp.intro).toBe("Dates from everything you follow.");
    const dates = comingUp.entries.map((e) => e.date);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates).toEqual([...dates].sort());
    // Filters narrow the feed, not Coming up (ui-revisions-1 item 6).
    const filtered = await feed("?type=photos&circle=Family&q=garden");
    expect(filtered.surfaces?.["river.panel"]).toEqual(panel);
  });

  it("Civic: civic items, the Civic theme, and the panel with Coming up and two placeholders", async () => {
    const civic = await feed("?mode=civic");
    expect(civic).toMatchObject({ mode: "civic", theme: "civic" });
    expect(civic.items.length).toBeGreaterThan(0);
    expect(civic.items.every((i) => i.space.category === "civic")).toBe(true);

    const panel = civic.surfaces?.["river.panel"] ?? [];
    expect(panel.map((p) => [p.id, p.title])).toEqual([
      ["coming-up", "Coming up"],
      ["your-representatives", "Your representatives"],
      ["elections-and-ballot", "Elections and ballot"],
    ]);
    const comingUp = panel[0]!.output;
    if (comingUp.type !== "dates") throw new Error("Coming up returns dates");
    const dates = comingUp.entries.map((e) => e.date);
    expect(dates).toContain(LONGMONT_DEADLINE);
    expect(dates).toEqual([...dates].sort());
    expect(dates.every((d) => d >= CLOCK)).toBe(true);
    expect(dates.length).toBeLessThanOrEqual(5);
    expect(comingUp.entries.find((e) => e.date === LONGMONT_DEADLINE)).toMatchObject({
      what: "deadline",
      spaceName: "Longmont Civic Hub",
      url: expect.stringMatching(/^https:\/\/longmont\.civic\.social\//),
    });
    expect(panel[1]!.output).toEqual({
      type: "placeholder",
      text: "Who represents you at each level, and how to reach them.",
      waitingOn: ["Open States", "Geocodio", "Cicero"],
    });
    expect(panel[2]!.output).toEqual({
      type: "placeholder",
      text: "Upcoming elections and what is on your ballot.",
      waitingOn: ["Democracy Works", "Ballotpedia"],
    });
  });

  it("the panel follows the view's filters and comes with the first page only", async () => {
    const posts = await feed("?mode=civic&type=posts");
    expect(posts.surfaces?.["river.panel"]?.map((p) => p.id)).toEqual(["your-representatives", "elections-and-ballot"]);
    const first = await feed("?mode=civic");
    if (first.nextCursor) {
      const next = await feed(`?mode=civic&cursor=${encodeURIComponent(first.nextCursor)}`);
      expect(next.surfaces).toBeNull();
    }
  });

  it("refuses a mode the instance doesn't offer", async () => {
    const res = await get("/feed?mode=party");
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: "bad_mode" });
  });
});

describe("check 8 (API part): an instance with modes_enabled = [civic]", () => {
  const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  const hostname = `civic-only-${randomUUID().slice(0, 8)}.localhost`;

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO river.instances (hostname, name, theme, modes_enabled, default_mode, seed_follows, default_circles)
       SELECT $1, 'Civic only (test)', 'civic', ARRAY['civic'], 'civic', seed_follows, default_circles
         FROM river.instances WHERE id = $2`,
      [hostname, SEED_INSTANCE],
    );
  });

  afterAll(async () => {
    await admin.query("DELETE FROM river.instances WHERE hostname = $1", [hostname]);
    await admin.end();
  });

  it("opens in Civic with one mode (so no switch) and the panel; Everything is refused", async () => {
    const civic = await feed("", hostname);
    expect(civic).toMatchObject({ mode: "civic", theme: "civic", modes: [{ id: "civic", title: "Civic" }] });
    expect(civic.instance).toMatchObject({ modes: ["civic"], defaultMode: "civic" });
    expect(civic.items.every((i) => i.space.category === "civic")).toBe(true);
    expect(civic.surfaces?.["river.panel"]?.map((p) => p.id)).toEqual([
      "coming-up",
      "your-representatives",
      "elections-and-ballot",
    ]);
    const everything = await get("/feed?mode=everything", hostname);
    expect(everything.status).toBe(400);
    expect(JSON.parse(everything.body)).toMatchObject({ error: "bad_mode" });
  });
});
