// Linking a fediverse account over HTTP (fediverse-posting-1.md item 1; checks 1 and 3), against
// the running dev server with TEST_STAND_IN_FEDIVERSE=1: every request to a member's server goes
// to the SYNTHETIC stand-in (tests/support/standInMastodon/), driven through its test routes.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, DidLogServer, requireApi, type Member } from "./helpers/member.js";
import { standIn } from "./helpers/standInFediverse.js";

const logs = new DidLogServer();
let member: Member;

beforeAll(async () => {
  await requireApi();
  await logs.start();
  member = await logs.signIn();
});

afterAll(async () => {
  await logs.close();
});

beforeEach(async () => {
  await standIn.reset();
});

function check(input: unknown, who: Member | null = member): Promise<Response> {
  return fetch(`${API}/linked-accounts/fediverse/check`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: member.origin, ...(who ? { cookie: who.cookie } : {}) },
    body: JSON.stringify({ input }),
  });
}

describe("POST /linked-accounts/fediverse/check", () => {
  it("finds a Mastodon 4.3 server and its limit, reading only public documents", async () => {
    const res = await check("@ana@mastodon.stand-in.example");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      handle: "@ana@mastodon.stand-in.example",
      server: "mastodon.stand-in.example",
      software: "Mastodon",
      maxCharacters: 500,
    });
    const requests = await standIn.requests();
    expect(requests.map((r) => `${r.method} ${r.path.split("?")[0]}`)).toEqual([
      "GET /.well-known/webfinger",
      "GET /.well-known/nodeinfo",
      "GET /nodeinfo/2.0",
      "GET /.well-known/oauth-authorization-server",
      "GET /api/v2/instance",
    ]);
    expect(requests.every((r) => r.headers.authorization === undefined && r.headers.cookie === undefined)).toBe(true);
  });

  it("finds GoToSocial with 5,000 characters, from a profile URL", async () => {
    const res = await check("https://gts.stand-in.example/@bob");
    expect(await res.json()).toMatchObject({ handle: "@bob@gts.stand-in.example", software: "GoToSocial", maxCharacters: 5000 });
  });

  it("refuses unsupported servers with their sentences, and registers nothing", async () => {
    const cases: Array<[string, number, string]> = [
      ["@ana@mastodon42.stand-in.example", 422, "The River can't post through this version of Mastodon yet."],
      ["@ana@nodiscovery.stand-in.example", 422, "The River can't post through this version of Mastodon yet."],
      ["@ana@akkoma.stand-in.example", 422, "The River can't post through Akkoma yet."],
      ["@nobody@mastodon.stand-in.example", 422, "mastodon.stand-in.example doesn't know @nobody@mastodon.stand-in.example. Check the handle."],
      ["ana@example.social", 400, "Type a handle like @ana@example.social, or the address of a profile page."],
    ];
    for (const [input, status, message] of cases) {
      const res = await check(input);
      expect(res.status, input).toBe(status);
      expect(((await res.json()) as { message: string }).message).toBe(message);
    }
    expect((await standIn.requests()).filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("says when the server is busy or can't be reached", async () => {
    await standIn.rules([{ host: "gts.stand-in.example", path: "/.well-known/nodeinfo", answer: 429, retryAfter: 1 }]);
    const busy = await check("@ana@gts.stand-in.example");
    expect(busy.status).toBe(503);
    expect(((await busy.json()) as { message: string }).message).toBe("gts.stand-in.example is busy; try again in a few minutes.");
    await standIn.rules([{ path: "/", answer: "down" }]);
    const down = await check("@ana@mastodon.stand-in.example");
    expect(down.status).toBe(502);
  });

  it("is for members, with the River's Origin", async () => {
    expect((await check("@ana@mastodon.stand-in.example", null)).status).toBe(401);
    const noOrigin = await fetch(`${API}/linked-accounts/fediverse/check`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: member.cookie },
      body: JSON.stringify({ input: "@ana@mastodon.stand-in.example" }),
    });
    expect(noOrigin.status).toBe(403);
    expect(await standIn.requests()).toHaveLength(0);
  });
});
