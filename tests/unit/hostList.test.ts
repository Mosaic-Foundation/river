// Host lists (src/shared/hosts/): an entry matches its own host or a subdomain on a dot boundary,
// never a host that merely ends with the same text (ADR-012 item 9; space-actions-1 4 step 4).
import { describe, expect, it } from "vitest";
import { hostInList, hostMatches, httpsUrlHostInList, isHostEntry, parseHostList } from "../../src/shared/hosts/index.js";

describe("hostMatches", () => {
  it.each([
    ["civic.social", "civic.social"],
    ["floyd.civic.social", "civic.social"],
    ["a.b.civic.social", "civic.social"],
    ["FLOYD.Civic.Social", "civic.social"],
    ["floyd.civic.social", "CIVIC.SOCIAL"],
    ["localhost:3001", "localhost:3001"],
    ["id.localhost:3001", "localhost:3001"],
    ["127.0.0.1:3001", "127.0.0.1:3001"],
    ["x-1.civic.social", "civic.social"],
  ])("%s is covered by %s", (host, entry) => {
    expect(hostMatches(host, entry)).toBe(true);
  });

  it.each([
    ["evilcivic.social", "civic.social", "same text, no dot boundary"],
    ["civic.social.example.com", "civic.social", "the entry as a prefix"],
    ["floyd-civic.social", "civic.social", "a hyphen is not a dot"],
    ["civic.social", "floyd.civic.social", "a parent of the entry"],
    ["social", "civic.social", "a suffix of the entry"],
    ["civic.social.", "civic.social", "a trailing dot"],
    [".civic.social", "civic.social", "a leading dot"],
    ["floyd..civic.social", "civic.social", "an empty label"],
    ["civic.social:443", "civic.social", "a port the entry doesn't name"],
    ["civic.social", "civic.social:443", "no port where the entry names one"],
    ["localhost:3002", "localhost:3001", "another port"],
    ["floyd.civic.social", "*.civic.social", "a wildcard entry"],
    ["floyd.civic.social", ".civic.social", "a leading-dot entry"],
    ["civic.social", "civic.social.", "a trailing-dot entry"],
    ["civic.social", "", "an empty entry"],
    ["", "civic.social", "an empty host"],
    ["civic.social/x", "civic.social", "a path"],
    ["user@civic.social", "civic.social", "userinfo"],
    ["1.127.0.0.1", "127.0.0.1", "a 'subdomain' of an IPv4 address"],
    ["[::1]:3001", "[::1]:3001", "IPv6 literals"],
    ["999.1.1.1", "999.1.1.1", "not an IPv4 address"],
    ["-civic.social", "civic.social", "a label starting with a hyphen"],
  ])("%s is not covered by %s (%s)", (host, entry) => {
    expect(hostMatches(host, entry)).toBe(false);
  });

  it("ignores values that aren't strings", () => {
    expect(hostMatches(undefined, "civic.social")).toBe(false);
    expect(hostMatches("civic.social", null)).toBe(false);
    expect(hostMatches(["civic.social"], "civic.social")).toBe(false);
  });
});

describe("hostInList", () => {
  it("matches when any entry covers the host, and never for an empty list", () => {
    expect(hostInList("floyd.civic.social", ["id.mosaic.social", "civic.social"])).toBe(true);
    expect(hostInList("evilcivic.social", ["id.mosaic.social", "civic.social"])).toBe(false);
    expect(hostInList("civic.social", [])).toBe(false);
  });
});

describe("httpsUrlHostInList", () => {
  const list = ["civic.social"];
  it("returns the host of an https URL on a listed host", () => {
    expect(httpsUrlHostInList("https://floyd.civic.social/actions", list)).toBe("floyd.civic.social");
    expect(httpsUrlHostInList("https://civic.social:443/actions", list)).toBe("civic.social");
  });
  it.each([
    "http://floyd.civic.social/actions",
    "https://evilcivic.social/actions",
    "https://civic.social.example.com/actions",
    "https://civic.social:8443/actions",
    "https://user:pw@floyd.civic.social/actions",
    "https://floyd.civic.social.@evil.example/",
    "not a url",
  ])("refuses %s", (url) => {
    expect(httpsUrlHostInList(url, list)).toBeUndefined();
  });
});

describe("parseHostList", () => {
  it("lowercases and keeps valid entries", () => {
    expect(parseHostList("X", [" Civic.Social ", "localhost:3001"])).toEqual(["civic.social", "localhost:3001"]);
    expect(isHostEntry("civic.social")).toBe(true);
  });
  it.each(["*.civic.social", ".civic.social", "civic.social.", "https://civic.social", "civic.social/x", ""])(
    "throws on %j, naming it",
    (entry) => {
      expect(() => parseHostList("SPACE_ACTION_HOSTS", [entry])).toThrow(/SPACE_ACTION_HOSTS/);
    },
  );
});
