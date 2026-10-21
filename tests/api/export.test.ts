// The member export over HTTP (spec 3.3, check 29), against the running dev server (`npm run dev`,
// reading .env with FETCH_FIXTURES_DIR and TEST_CLOCK_NOW). Members sign in through the River's
// real callback with test DIDs (tests/api/helpers/member.ts); each run makes new members.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API, DidLogServer, requireApi, type Member } from "./helpers/member.js";

interface Export {
  format: string;
  version: number;
  exported_at: string;
  did: string | null;
  follows: Array<{ url: string; stream_key: string | null; rule: string; circles: string[] }>;
  circles: Array<{ name: string; color: string | null; role: string | null }>;
  preferences: Record<string, unknown>;
}

interface FollowingPage {
  spaces: Array<{ id: string; name: string; following: boolean; address: string; streams: Array<{ id: string; key: string }> }>;
}

const logs = new DidLogServer();
let alice: Member;
let bob: Member;

beforeAll(async () => {
  await requireApi();
  await logs.start();
  // The seed spaces exist once anyone has opened the River (a fresh db reset has none yet).
  await fetch(`${API}/feed`);
  alice = await logs.signIn();
  bob = await logs.signIn();
}, 30_000);

afterAll(async () => {
  await logs.close();
});

function exportOf(member?: Member): Promise<Response> {
  return fetch(`${API}/me/export`, { headers: member ? { cookie: member.cookie } : {} });
}

async function exportJson(member: Member): Promise<Export> {
  const res = await exportOf(member);
  expect(res.status).toBe(200);
  return (await res.json()) as Export;
}

function write(member: Member, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: member.cookie, origin: member.origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET /api/me/export (check 29)", () => {
  it("is 401 for a visitor, and for a session cookie that doesn't verify", async () => {
    const visitor = await exportOf();
    expect(visitor.status).toBe(401);
    expect(await visitor.json()).toMatchObject({ error: "sign_in_required" });
    const forged = await fetch(`${API}/me/export`, { headers: { cookie: "__Host-river-session=forged.value" } });
    expect(forged.status).toBe(401);
  });

  it("returns spec 3.3's document for a member, as a JSON download that isn't cached", async () => {
    const res = await exportOf(alice);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="mosaic-river-export.json"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const doc = (await res.json()) as Export;

    expect(Object.keys(doc).sort()).toEqual(["circles", "did", "exported_at", "follows", "format", "preferences", "version"]);
    expect(doc.format).toBe("mosaic-river-export");
    expect(doc.version).toBe(1);
    expect(Math.abs(Date.parse(doc.exported_at) - Date.now())).toBeLessThan(60_000);
    expect(doc.did).toBe(alice.did);
    expect(doc.did).toMatch(/^did:webvh:/);
    expect(doc.preferences).toEqual({});

    // The seed's default circles, copied at sign-up, with the civic role.
    expect(doc.circles.slice(0, 2)).toEqual([
      { name: "Civic", color: "#2F6FA8", role: "civic" },
      { name: "News and ideas", color: "#7A5AA6", role: null },
    ]);
    for (const c of doc.circles) expect(Object.keys(c).sort()).toEqual(["color", "name", "role"]);

    // The seed follows, by canonical URL, whole spaces, with their circles.
    for (const f of doc.follows) expect(Object.keys(f).sort()).toEqual(["circles", "rule", "stream_key", "url"]);
    const demosville = doc.follows.find((f) => f.url === "https://demosville.civic.social");
    expect(demosville).toEqual({ url: "https://demosville.civic.social", stream_key: null, rule: "follow", circles: ["Civic"] });
    const w3c = doc.follows.find((f) => f.url === "https://w3c.social/users/w3c");
    expect(w3c).toMatchObject({ stream_key: null, rule: "follow", circles: ["News and ideas"] });
    expect(doc.follows.length).toBeGreaterThanOrEqual(9);

    // Nothing but what the River holds: no email address, no key material.
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/email|@example\.test|PRIVATE KEY|private_key|"d":/i);
  });

  it("follows the member's changes: a new circle, its space, a muted stream, an unfollow", async () => {
    const page = (await (await fetch(`${API}/following`, { headers: { cookie: alice.cookie } })).json()) as FollowingPage;
    const longmont = page.spaces.find((s) => s.address === "longmont.civic.social" || s.name.includes("Longmont"));
    expect(longmont, "Longmont is a seed follow").toBeDefined();
    const stream = longmont!.streams[0];
    expect(stream, "Longmont has a known stream").toBeDefined();

    const made = await write(alice, "POST", "/circles", { name: "Town hall", color: "#336699" });
    expect(made.status).toBe(201);
    const { circle } = (await made.json()) as { circle: { id: string } };
    expect((await write(alice, "PUT", `/circles/${circle.id}/spaces/${longmont!.id}`)).status).toBe(204);
    expect((await write(alice, "PUT", `/following/streams/${stream!.id}`, { rule: "mute" })).status).toBeLessThan(300);
    const floyd = page.spaces.find((s) => s.address === "floyd.civic.social" || s.name.includes("Floyd"));
    expect(floyd, "Floyd is a seed follow").toBeDefined();
    expect((await write(alice, "DELETE", `/following/spaces/${floyd!.id}`)).status).toBeLessThan(300);

    const doc = await exportJson(alice);
    expect(doc.circles).toContainEqual({ name: "Town hall", color: "#336699", role: null });
    expect(doc.follows.find((f) => f.url === "https://longmont.civic.social" && f.stream_key === null)).toEqual({
      url: "https://longmont.civic.social",
      stream_key: null,
      rule: "follow",
      circles: ["Civic", "Town hall"],
    });
    expect(doc.follows.find((f) => f.stream_key === stream!.key)).toEqual({
      url: "https://longmont.civic.social",
      stream_key: stream!.key,
      rule: "mute",
      circles: ["Civic", "Town hall"],
    });
    expect(stream!.key).toMatch(/^https:\/\/longmont\.civic\.social\/process\//);
    expect(doc.follows.some((f) => f.url === "https://floyd.civic.social")).toBe(false);
  });

  it("holds only the signed-in member's rows (check 27)", async () => {
    const doc = await exportJson(bob);
    expect(doc.did).toBe(bob.did);
    expect(doc.circles.some((c) => c.name === "Town hall")).toBe(false);
    expect(doc.follows.some((f) => f.rule === "mute")).toBe(false);
    expect(doc.follows.some((f) => f.url === "https://floyd.civic.social")).toBe(true);
  });
});
