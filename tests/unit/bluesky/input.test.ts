// What the follow box takes as a Bluesky account (ADR-009 item 2), and how the registry routes it.
import { describe, expect, it } from "vitest";
import {
  canonicalUrlFor,
  didFromCanonical,
  normalizeHandle,
  parseInput,
  postUrl,
} from "../../../src/river/adapters/bluesky/index.js";
import { adaptersFor } from "../../../src/river/adapters/index.js";

describe("parseInput", () => {
  it.each([
    ["@bsky.app", { kind: "handle", handle: "bsky.app" }],
    ["@PublicDomainRev.bsky.social", { kind: "handle", handle: "publicdomainrev.bsky.social" }],
    ["publicdomainrev.bsky.social", { kind: "handle", handle: "publicdomainrev.bsky.social" }],
    ["https://bsky.app/profile/publicdomainrev.bsky.social", { kind: "handle", handle: "publicdomainrev.bsky.social" }],
    ["https://bsky.app/profile/wikipedia.org/", { kind: "handle", handle: "wikipedia.org" }],
    ["https://bsky.app/profile/did:plc:ewvi7nxzyoun6zhxrhs64oiz", { kind: "did", did: "did:plc:ewvi7nxzyoun6zhxrhs64oiz" }],
    ["did:plc:ewvi7nxzyoun6zhxrhs64oiz", { kind: "did", did: "did:plc:ewvi7nxzyoun6zhxrhs64oiz" }],
    ["did:web:example.com", { kind: "did", did: "did:web:example.com" }],
    ["at://did:plc:ewvi7nxzyoun6zhxrhs64oiz", { kind: "did", did: "did:plc:ewvi7nxzyoun6zhxrhs64oiz" }],
    ["at://atproto.com", { kind: "handle", handle: "atproto.com" }],
  ])("takes %s", (input, parsed) => {
    expect(parseInput(input)).toEqual(parsed);
  });

  it.each([
    ["@w3c@w3c.social", "a fediverse handle"],
    ["example.com", "a bare custom domain: a web address"],
    ["https://example.com/profile/bsky.app", "a profile path on another host"],
    ["http://bsky.app/profile/bsky.app", "http"],
    ["https://bsky.app/profile/bsky.app/post/3myi3k45jh22z", "a post, not an account"],
    ["at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3myi3k45jh22z", "a record URI"],
    ["did:plc:short", "a malformed did:plc"],
    ["did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", "a DID method the River can't resolve"],
    ["@localhost", "one label"],
    ["@printer.local", "a disallowed TLD"],
    ["@name.123", "a numeric TLD"],
    ["someone@example.org", "an email address"],
    ["@-bad.bsky.social", "a label starting with a hyphen"],
    ["did:%", "malformed percent-encoding in a DID"],
    ["at://%zz", "malformed percent-encoding in an at:// URI"],
    ["https://bsky.app/profile/%E0", "malformed percent-encoding in a profile URL"],
  ])("refuses %s (%s)", (input) => {
    expect(parseInput(input)).toBeUndefined();
  });

  it("normalizes handles to lower case and checks their length", () => {
    expect(normalizeHandle("Bsky.App")).toBe("bsky.app");
    expect(normalizeHandle(`${"a".repeat(64)}.com`)).toBeUndefined();
  });
});

describe("routing in the follow box", () => {
  it("gives Bluesky shapes to the Bluesky adapter alone", () => {
    for (const input of [
      "@bsky.app",
      "publicdomainrev.bsky.social",
      "https://bsky.app/profile/publicdomainrev.bsky.social",
      "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
    ]) {
      expect(adaptersFor(input).map((a) => a.name), input).toEqual(["atproto"]);
    }
  });

  it("never throws on malformed input (the follow box asks every adapter)", () => {
    expect(() => adaptersFor("https://bsky.app/profile/%E0")).not.toThrow();
    expect(adaptersFor("did:%")).toEqual([]);
  });

  it("leaves fediverse handles and web addresses to the other adapters", () => {
    expect(adaptersFor("@w3c@w3c.social").map((a) => a.name)).toEqual(["fediverse"]);
    expect(adaptersFor("floyd.civic.social").map((a) => a.name)).toEqual(["civic_hub"]);
  });
});

describe("URLs", () => {
  it("keys a space by DID and links posts on bsky.app by DID", () => {
    expect(canonicalUrlFor("did:plc:z72i7hdynmk6r22z27h6tvur")).toBe("at://did:plc:z72i7hdynmk6r22z27h6tvur");
    expect(didFromCanonical("at://did:plc:z72i7hdynmk6r22z27h6tvur")).toBe("did:plc:z72i7hdynmk6r22z27h6tvur");
    expect(didFromCanonical("https://bsky.app")).toBeUndefined();
    expect(postUrl("at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3myi3k45jh22z")).toBe(
      "https://bsky.app/profile/did:plc:z72i7hdynmk6r22z27h6tvur/post/3myi3k45jh22z",
    );
    expect(postUrl("at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.repost/3myko2d3dz726")).toBeUndefined();
  });
});
