// Finding a member's server before linking (fediverse-posting-1.md item 1.2; acceptance checks 1
// and 3, their discovery half), against the SYNTHETIC stand-in server behind the real fetch guard.
import { beforeEach, describe, expect, it } from "vitest";
import { createFetchGuard, type FetchGuard } from "../../src/shared/fetch/index.js";
import {
  checkServer,
  findAccount,
  LinkError,
  parseVersion,
  scopesFor,
  softwareLabel,
} from "../../src/river/acting/fediverse/server.js";
import {
  AKKOMA_HOST,
  GTS_HOST,
  MASTODON_HOST,
  NO_DISCOVERY_HOST,
  OLD_MASTODON_HOST,
  StandInFediverse,
} from "../support/standInMastodon/index.js";

let standIn: StandInFediverse;
let guard: FetchGuard;

beforeEach(() => {
  standIn = new StandInFediverse();
  guard = createFetchGuard(standIn.guardOptions());
});

async function refusal(promise: Promise<unknown>): Promise<LinkError> {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(LinkError);
  return err as LinkError;
}

describe("findAccount", () => {
  it("resolves a handle to its actor and server", async () => {
    expect(await findAccount(guard, `@ana@${MASTODON_HOST}`)).toEqual({
      handle: `@ana@${MASTODON_HOST}`,
      name: "ana",
      actorUri: `https://${MASTODON_HOST}/users/ana`,
      host: MASTODON_HOST,
    });
  });

  it("takes a profile URL", async () => {
    const account = await findAccount(guard, `https://${GTS_HOST}/@bob`);
    expect(account).toMatchObject({ handle: `@bob@${GTS_HOST}`, host: GTS_HOST });
  });

  it("refuses what isn't a handle or a profile URL, and unknown accounts", async () => {
    for (const input of ["ana@example.social", "https://example.social/about", "hello"]) {
      expect((await refusal(findAccount(guard, input))).code).toBe("bad_input");
    }
    const missing = await refusal(findAccount(guard, `@nobody@${MASTODON_HOST}`));
    expect(missing.code).toBe("not_found");
    expect(missing.message).toBe(`${MASTODON_HOST} doesn't know @nobody@${MASTODON_HOST}. Check the handle.`);
  });

  it("says the server couldn't be reached", async () => {
    const err = await refusal(findAccount(guard, "@ana@unknown.example"));
    expect(err).toMatchObject({ code: "unreachable", message: "We couldn't reach unknown.example. Try again in a few minutes." });
  });
});

describe("checkServer", () => {
  it("accepts Mastodon 4.3 with S256 and reads its limits", async () => {
    expect(await checkServer(guard, MASTODON_HOST)).toEqual({
      host: MASTODON_HOST,
      software: "mastodon",
      version: "4.3.2",
      scopes: ["profile", "write:statuses", "write:favourites", "write:follows", "read:follows", "read:search"],
      maxCharacters: 500,
      charactersReservedPerUrl: 23,
    });
    const paths = standIn.requestsTo(MASTODON_HOST).map((r) => r.path);
    expect(paths).toEqual(["/.well-known/nodeinfo", "/nodeinfo/2.0", "/.well-known/oauth-authorization-server", "/api/v2/instance"]);
    // None of these carries a credential.
    expect(standIn.requests.every((r) => r.headers.authorization === undefined)).toBe(true);
  });

  it("accepts GoToSocial 0.19 without a discovery document, with read:accounts and 5,000 characters", async () => {
    const info = await checkServer(guard, GTS_HOST);
    expect(info).toMatchObject({ software: "gotosocial", maxCharacters: 5000 });
    expect(info.scopes[0]).toBe("read:accounts");
    expect(standIn.requestsTo(GTS_HOST, "/.well-known/oauth-authorization-server")).toHaveLength(0);
  });

  it("refuses Mastodon 4.2, a Mastodon without discovery, and Akkoma, each with its sentence", async () => {
    expect(await refusal(checkServer(guard, OLD_MASTODON_HOST))).toMatchObject({
      code: "unsupported_version",
      message: "The River can't post through this version of Mastodon yet.",
    });
    expect((await refusal(checkServer(guard, NO_DISCOVERY_HOST))).code).toBe("unsupported_version");
    expect(await refusal(checkServer(guard, AKKOMA_HOST))).toMatchObject({
      code: "unsupported_software",
      message: "The River can't post through Akkoma yet.",
    });
    // Nothing was registered anywhere.
    expect(standIn.requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("refuses a Mastodon whose discovery document doesn't answer", async () => {
    standIn.rules.push({ host: MASTODON_HOST, path: "/.well-known/oauth-authorization-server", answer: 503 });
    expect((await refusal(checkServer(guard, MASTODON_HOST))).code).toBe("unsupported_version");
  });

  it("a 429 says the server is busy", async () => {
    standIn.rules.push({ host: GTS_HOST, path: "/.well-known/nodeinfo", answer: 429, retryAfter: 60 });
    expect(await refusal(checkServer(guard, GTS_HOST))).toMatchObject({
      code: "busy",
      message: `${GTS_HOST} is busy; try again in a few minutes.`,
    });
  });

  it("a dropped connection is unreachable", async () => {
    standIn.rules.push({ host: GTS_HOST, path: "/", answer: "down" });
    expect((await refusal(checkServer(guard, GTS_HOST))).code).toBe("unreachable");
  });

  it("uses the defaults when the instance document can't be read", async () => {
    standIn.rules.push({ host: GTS_HOST, path: "/api/v2/instance", answer: 500 });
    expect((await checkServer(guard, GTS_HOST)).maxCharacters).toBe(5000);
  });
});

describe("helpers", () => {
  it("parses versions", () => {
    expect(parseVersion("4.3.2")).toEqual([4, 3]);
    expect(parseVersion("4.4.0-nightly.2026-10-01")).toEqual([4, 4]);
    expect(parseVersion("0.19.1 git-2b3c4d5")).toEqual([0, 19]);
    expect(parseVersion("v4.10.0+glitch")).toEqual([4, 10]);
    expect(parseVersion("nightly")).toBeUndefined();
  });

  it("names software and lists scopes without umbrella or admin scopes", () => {
    expect(softwareLabel("gotosocial")).toBe("GoToSocial");
    expect(softwareLabel("<b>weird</b>")).toBe("bweirdb");
    for (const software of ["mastodon", "gotosocial"] as const) {
      const scopes = scopesFor(software);
      expect(scopes).not.toContain("read");
      expect(scopes).not.toContain("write");
      expect(scopes.some((s) => s.startsWith("admin"))).toBe(false);
      expect(scopes).not.toContain("write:media");
    }
  });
});
