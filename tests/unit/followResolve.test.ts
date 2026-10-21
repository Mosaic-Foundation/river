// The follow box's resolve (spec F6, 4.2, 4.3; checks 13, 14, 15 preview half, 16): adapter order
// (hub first for URLs, then fediverse), the preview's name, icon and kind, and the four error
// sentences. Recorded fixtures through the real fetch guard; nothing touches the network.
import { describe, expect, it } from "vitest";
import { AdapterError } from "../../src/shared/items/index.js";
import {
  addressOf,
  followErrorMessage,
  kindLabel,
  previewView,
  resolveInput,
} from "../../src/river/following/resolve.js";
import { derived, NOW, replayGuard } from "./helpers/fediverseFixtures.js";

async function failure(input: string, overrides: Parameters<typeof replayGuard>[0] = []) {
  const replay = replayGuard(overrides);
  try {
    await resolveInput(input, { guard: replay.guard, now: NOW });
  } catch (err) {
    return { ...followErrorMessage(err), calls: replay.calls, err };
  }
  throw new Error(`expected ${input} to fail`);
}

describe("follow box: resolve and preview", () => {
  it("check 13: a hub URL previews the hub's name, no icon (initials), kind Civic Hub", async () => {
    const replay = replayGuard();
    const preview = previewView(await resolveInput("https://demosville.civic.social", { guard: replay.guard, now: NOW }));
    expect(preview).toMatchObject({
      adapter: "civic_hub",
      name: "Demosville Civic Hub",
      iconUrl: null,
      kind: "Civic Hub",
      category: "civic",
      address: "demosville.civic.social",
      canonicalUrl: "https://demosville.civic.social",
      stream: null,
    });
    expect(replay.calls).toEqual(["GET https://demosville.civic.social/.well-known/civic.json"]);
  });

  it("check 14: a Longmont meeting-summary URL names its /process/ stream, validated with probeStream", async () => {
    const replay = replayGuard();
    const preview = previewView(
      await resolveInput("https://longmont.civic.social/meeting-summary/proc_4ebb11759c4c40ce", { guard: replay.guard, now: NOW }),
    );
    expect(preview.stream?.key).toBe("https://longmont.civic.social/process/proc_4ebb11759c4c40ce");
    expect(preview.address).toBe("longmont.civic.social");
    expect(replay.calls[1]).toContain("context=https%3A%2F%2Flongmont.civic.social%2Fprocess%2Fproc_4ebb11759c4c40ce");
  });

  it("check 15: @w3c@w3c.social previews name and avatar, kind from NodeInfo, the handle as address", async () => {
    const replay = replayGuard();
    const preview = previewView(await resolveInput("  @w3c@w3c.social ", { guard: replay.guard, now: NOW }));
    expect(preview).toMatchObject({
      adapter: "fediverse",
      name: "World Wide Web Consortium",
      kind: "Mastodon account",
      address: "@w3c@w3c.social",
      stream: null,
    });
    expect(preview.iconUrl).toMatch(/^https:\/\/w3csocial\.files\.fedi\.monster\/accounts\/avatars\//);
  });

  it("a profile URL the hub adapter takes but isn't a hub falls to the fediverse adapter (DERIVED 404 civic.json)", async () => {
    const notAHub = derived("https://mastodon.social/.well-known/civic.json", {
      from: "https://mastodon.social/users/eff",
      status: 404,
      body: '{"error":"Not Found"}',
      headers: { "content-type": "application/json" },
    });
    const replay = replayGuard([notAHub]);
    const preview = previewView(await resolveInput("https://mastodon.social/users/eff", { guard: replay.guard, now: NOW }));
    expect(preview.adapter).toBe("fediverse");
    expect(preview.address).toBe("@eff@mastodon.social");
    expect(replay.calls[0]).toBe("GET https://mastodon.social/.well-known/civic.json");
  });
});

describe("follow box: errors in spec F6's words", () => {
  it("check 16: an address the guard refuses can't be followed, and nothing is sent", async () => {
    for (const input of ["http://example.org", "https://localhost", "https://127.0.0.1", "https://10.0.0.5", "https://[::1]"]) {
      const { message, calls } = await failure(input);
      expect(message, input).toBe("This address can't be followed");
      expect(calls, input).toEqual([]);
    }
  });

  it("text that isn't an address isn't a Space we can follow", async () => {
    for (const input of ["", "hello", "someone@example.org", "urn:mosaic:sample:okafor-family", "x".repeat(501)]) {
      expect((await failure(input)).message, input).toBe("That address isn't a Space we can follow");
    }
  });

  it("a hub process the hub doesn't serve isn't a Space we can follow (recorded empty probe)", async () => {
    const { message } = await failure("https://floyd.civic.social/process/proc_0000000000000000");
    expect(message).toBe("That address isn't a Space we can follow");
  });

  it("a host with nothing recorded can't be reached", async () => {
    expect((await failure("https://nothing-recorded.example")).message).toBe("We couldn't reach that address");
  });

  it("a non-Mastodon server that refuses unsigned reads only shares posts with other servers (DERIVED 401 actor)", async () => {
    const refused = derived("https://socialwebfoundation.org/@swf", {
      status: 401,
      from: "https://mastodon.social/users/eff",
      headers: { "content-type": "application/json" },
    });
    const { message } = await failure("@swf@socialwebfoundation.org", [refused]);
    expect(message).toBe("This server only shares posts with other servers");
  });

  it("anything unexpected reads as unreachable", () => {
    expect(followErrorMessage(new Error("boom")).message).toBe("We couldn't reach that address");
    expect(followErrorMessage(new AdapterError("refused", "detail (x)")).message).toBe("This address can't be followed");
  });
});

describe("labels", () => {
  it("names kinds and addresses", () => {
    expect(kindLabel("civic_hub", null)).toBe("Civic Hub");
    expect(kindLabel("fediverse", "wordpress")).toBe("WordPress account");
    expect(kindLabel("fediverse", null)).toBe("Fediverse account");
    expect(kindLabel("sample", null)).toBe("Sample entries");
    // M12
    expect(kindLabel("fediverse", "peertube", "video")).toBe("PeerTube channel");
    expect(kindLabel("fediverse", "peertube", "person")).toBe("PeerTube account");
    expect(kindLabel("rss", "rss", "podcast")).toBe("Podcast feed");
    expect(kindLabel("rss", "rss", "publication")).toBe("RSS feed");
    expect(kindLabel("rss", "atom", "publication")).toBe("Atom feed");
    expect(addressOf({ adapter: "fediverse", canonical_url: "https://w3c.social/users/w3c", manifest: { actor: { handle: "@w3c@w3c.social" } } })).toBe(
      "@w3c@w3c.social",
    );
    expect(addressOf({ adapter: "civic_hub", canonical_url: "https://floyd.civic.social" })).toBe("floyd.civic.social");
    expect(addressOf({ adapter: "sample", canonical_url: "urn:mosaic:sample:x" })).toBe("Sample entries");
  });
});
