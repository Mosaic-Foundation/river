// The fetch guard (spec Appendix B, ADR-001) and acceptance check 16. No test reaches the
// network: requests go to undici's MockAgent, names to an injected resolver.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockAgent, type Dispatcher } from "undici";
import {
  FetchError,
  createFetchGuard,
  fixtureFromResponse,
  fixturePath,
  followMessage,
  isBlockedHostname,
  isBlockedIp,
  loadFixtures,
  saveFixture,
  USER_AGENT,
  type FetchGuardOptions,
  type HttpFixture,
  type Resolver,
} from "../../src/shared/fetch/index.js";
import { pinnedLookup } from "../../src/shared/fetch/guard.js";
import { fixtureResolver, mockAgentFromFixtures, replayOptions } from "../../src/shared/fetch/fixtures.js";

const PUBLIC = { address: "93.184.215.14", family: 4 };

/** Public names resolve to PUBLIC; `internal.example` to a private address; others don't resolve. */
const resolver: Resolver = async (host) => {
  if (host === "internal.example") return [{ address: "10.1.2.3", family: 4 }];
  if (host === "split.example") return [PUBLIC, { address: "127.0.0.1", family: 4 }];
  if (host === "v6.example") return [{ address: "fd00::1", family: 6 }];
  if (host.endsWith(".example") || host.endsWith(".test")) return [PUBLIC];
  throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
};

interface Spy {
  dispatcher: Dispatcher;
  mock: MockAgent;
  calls: string[];
  maxActive: () => number;
}

/** A MockAgent wrapped so the test sees every request the guard sends and how many overlap. */
function spyAgent(): Spy {
  const mock = new MockAgent();
  mock.disableNetConnect();
  const calls: string[] = [];
  let active = 0;
  let max = 0;
  const dispatcher = {
    async request(opts: Dispatcher.RequestOptions) {
      calls.push(`${opts.method} ${String(opts.origin)}${opts.path}`);
      active += 1;
      max = Math.max(max, active);
      try {
        return await mock.request(opts);
      } finally {
        active -= 1;
      }
    },
  } as unknown as Dispatcher;
  return { dispatcher, mock, calls, maxActive: () => max };
}

function guardWith(spy: Spy, extra: FetchGuardOptions = {}) {
  return createFetchGuard({ resolver, dispatcher: spy.dispatcher, ...extra });
}

async function refusal(promise: Promise<unknown>): Promise<FetchError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof FetchError) return err;
    throw err;
  }
  throw new Error("expected the guard to refuse");
}

describe("isBlockedIp (ported from the Civic Hub)", () => {
  it("blocks loopback, private, link-local, metadata, CGNAT, multicast and IPv4-in-IPv6 forms", () => {
    for (const ip of [
      "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
      "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1",
      "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1", "::7f00:1", "64:ff9b::7f00:1",
      "2002:7f00:1::", "2001:0:1::1", "fe80::1%en0", "febf::1", "[::1]", "::", "198.18.0.1",
      "240.0.0.1",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("fails closed on anything that isn't an address", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });

  it("refuses localhost names before DNS", () => {
    for (const name of ["localhost", "LOCALHOST", "localhost.", "api.localhost"]) expect(isBlockedHostname(name), name).toBe(true);
    expect(isBlockedHostname("localhost.example")).toBe(false);
  });
});

describe("check 16: refused with \"This address can't be followed\", and nothing is requested", () => {
  it.each([
    ["http://example.org", "not_https"],
    ["https://localhost", "blocked_address"],
    ["https://127.0.0.1", "blocked_address"],
    ["https://10.0.0.5", "blocked_address"],
    ["https://169.254.169.254", "blocked_address"],
    ["https://[::1]", "blocked_address"],
    ["https://[::ffff:127.0.0.1]", "blocked_address"],
    ["https://internal.example/feed", "blocked_address"], // a hostname resolving to a private address
    ["https://split.example/", "blocked_address"], // any private answer among several
    ["https://v6.example/", "blocked_address"],
    ["https://2130706433/", "blocked_address"], // 127.0.0.1 written as one number
    ["https://user:pass@public.example/", "credentials"],
    ["file:///etc/passwd", "not_https"],
  ])("%s", async (url, code) => {
    const spy = spyAgent();
    const err = await refusal(guardWith(spy).fetch(url));
    expect(err.code).toBe(code);
    expect(followMessage(err)).toBe("This address can't be followed");
    expect(spy.calls).toEqual([]);
  });

  it.each([
    ["a redirect to a private address", "https://10.0.0.5/admin", "blocked_address"],
    ["a redirect to a name that resolves privately", "https://internal.example/", "blocked_address"],
    ["a redirect to http:", "http://public.example/feed", "not_https"],
  ])("%s", async (_label, target, code) => {
    const spy = spyAgent();
    spy.mock.get("https://public.example").intercept({ path: "/start" }).reply(302, "", { headers: { location: target } });
    const err = await refusal(guardWith(spy).fetch("https://public.example/start"));
    expect(err.code).toBe(code);
    expect(followMessage(err)).toBe("This address can't be followed");
    // Only the first hop was sent; the redirect target never was.
    expect(spy.calls).toEqual(["GET https://public.example/start"]);
  });
});

describe("pinned connections", () => {
  function lookup(r: Resolver, host: string, all = true) {
    return new Promise<{ err: unknown; result: unknown }>((resolve) => {
      pinnedLookup(r)(host, { all }, (err, address, family) => resolve({ err, result: all ? address : [address, family] }));
    });
  }

  it("hands the socket the one address it checked", async () => {
    const two: Resolver = async () => [PUBLIC, { address: "93.184.215.15", family: 4 }];
    expect(await lookup(two, "public.example")).toEqual({ err: null, result: [PUBLIC] });
    expect(await lookup(two, "public.example", false)).toEqual({ err: null, result: [PUBLIC.address, 4] });
  });

  it("refuses at connect time if DNS now answers with a private address (rebinding)", async () => {
    let calls = 0;
    const rebinding: Resolver = async () => (calls++ === 0 ? [PUBLIC] : [{ address: "127.0.0.1", family: 4 }]);
    expect((await lookup(rebinding, "rebind.example")).err).toBeNull();
    const second = await lookup(rebinding, "rebind.example");
    expect(second.err).toBeInstanceOf(FetchError);
    expect((second.err as FetchError).code).toBe("blocked_address");
  });

  it("refuses localhost and unresolvable names", async () => {
    expect(((await lookup(resolver, "localhost")).err as FetchError).code).toBe("blocked_address");
    expect(((await lookup(resolver, "nowhere.invalid")).err as FetchError).code).toBe("unresolvable_host");
  });
});

describe("requests", () => {
  it("sends the River's User-Agent, returns a Response with the final URL", async () => {
    const spy = spyAgent();
    spy.mock
      .get("https://public.example")
      .intercept({ path: "/a?b=1", headers: { "user-agent": USER_AGENT, accept: "application/json" } })
      .reply(200, '{"ok":true}', { headers: { "content-type": "application/json" } });
    const sent: Array<Record<string, string>> = [];
    const recording = {
      request(opts: Dispatcher.RequestOptions) {
        sent.push(opts.headers as Record<string, string>);
        return spy.mock.request(opts);
      },
    } as unknown as Dispatcher;
    const res = await createFetchGuard({ resolver, dispatcher: recording }).fetch("https://public.example/a?b=1", {
      headers: { accept: "application/json", "User-Agent": "spoofed", Host: "internal.example" },
    });
    expect(sent).toEqual([{ accept: "application/json", "user-agent": USER_AGENT }]);
    expect(res.status).toBe(200);
    expect(res.url).toBe("https://public.example/a?b=1");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("with redirect: error, refuses any 3xx and sends nothing to its target (credential-carrying requests)", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const spy = spyAgent();
      spy.mock.get("https://public.example").intercept({ path: "/oauth/revoke", method: "POST" }).reply(status, "", {
        headers: { location: "https://other.example/steal" },
      });
      const err = await refusal(
        guardWith(spy).fetch("https://public.example/oauth/revoke", { method: "POST", body: "token=secret", redirect: "error" }),
      );
      expect(err.code, String(status)).toBe("redirect_refused");
      expect(spy.calls, String(status)).toEqual(["POST https://public.example/oauth/revoke"]);
    }
  });

  it("follows up to 3 redirects, each checked, and refuses a 4th", async () => {
    const spy = spyAgent();
    const origin = spy.mock.get("https://public.example");
    origin.intercept({ path: "/1" }).reply(301, "", { headers: { location: "/2" } });
    origin.intercept({ path: "/2" }).reply(302, "", { headers: { location: "https://other.example/3" } });
    spy.mock.get("https://other.example").intercept({ path: "/3" }).reply(307, "", { headers: { location: "https://public.example/4" } });
    origin.intercept({ path: "/4" }).reply(200, "done");
    const res = await guardWith(spy).fetch("https://public.example/1");
    expect(await res.text()).toBe("done");
    expect(res.url).toBe("https://public.example/4");

    const loop = spyAgent();
    loop.mock.get("https://public.example").intercept({ path: /.*/ }).reply(302, "", { headers: { location: "/again" } }).persist();
    expect((await refusal(guardWith(loop).fetch("https://public.example/x"))).code).toBe("too_many_redirects");
    expect(loop.calls).toHaveLength(4);
  });

  it("refuses a body over the cap, whether declared or streamed", async () => {
    const spy = spyAgent();
    const origin = spy.mock.get("https://public.example");
    origin.intercept({ path: "/declared" }).reply(200, "x", { headers: { "content-length": String(3 * 1024 * 1024) } });
    origin.intercept({ path: "/streamed" }).reply(200, "y".repeat(5000));
    origin.intercept({ path: "/fits" }).reply(200, "z".repeat(1000));
    const guard = guardWith(spy, { maxBytes: 4096 });
    expect((await refusal(guardWith(spy).fetch("https://public.example/declared"))).code).toBe("too_large");
    expect((await refusal(guard.fetch("https://public.example/streamed"))).code).toBe("too_large");
    expect((await (await guard.fetch("https://public.example/fits")).text()).length).toBe(1000);
  });

  it("gives up after the time budget, covering every hop", async () => {
    const spy = spyAgent();
    spy.mock.get("https://slow.example").intercept({ path: "/" }).reply(200, "late").delay(500);
    const err = await refusal(guardWith(spy, { timeoutMs: 50 }).fetch("https://slow.example/"));
    expect(err.code).toBe("timeout");
    expect(followMessage(err)).toBe("We couldn't reach that address");
  });

  it("keeps at most 2 requests in flight per host, and other hosts aren't held up", async () => {
    const spy = spyAgent();
    for (const host of ["https://busy.example", "https://quiet.example"]) {
      spy.mock.get(host).intercept({ path: /.*/ }).reply(200, "ok").delay(30).persist();
    }
    const guard = guardWith(spy);
    await Promise.all([1, 2, 3, 4, 5].map((n) => guard.fetch(`https://busy.example/${n}`)));
    expect(spy.maxActive()).toBe(2);
    expect(spy.calls).toHaveLength(5);

    // Without the limit the same burst overlaps more, so the assertion above means something.
    const unlimited = spyAgent();
    unlimited.mock.get("https://busy.example").intercept({ path: /.*/ }).reply(200, "ok").delay(30).persist();
    const loose = guardWith(unlimited, { maxPerHost: 10 });
    await Promise.all([1, 2, 3, 4, 5].map((n) => loose.fetch(`https://busy.example/${n}`)));
    expect(unlimited.maxActive()).toBeGreaterThan(2);
  });

  it("honors Retry-After: the host is refused until then, without a request", async () => {
    let clock = 1_000_000;
    const spy = spyAgent();
    const origin = spy.mock.get("https://busy.example");
    origin.intercept({ path: "/a" }).reply(429, "slow down", { headers: { "retry-after": "120" } });
    origin.intercept({ path: "/b" }).reply(200, "ok");
    const guard = guardWith(spy, { now: () => clock });

    expect((await guard.fetch("https://busy.example/a")).status).toBe(429);
    const err = await refusal(guard.fetch("https://busy.example/b"));
    expect(err.code).toBe("retry_later");
    expect(err.retryAt).toBe(1_000_000 + 120_000);
    expect(spy.calls).toEqual(["GET https://busy.example/a"]);

    clock += 120_000;
    expect((await guard.fetch("https://busy.example/b")).status).toBe(200);
  });

  it("reads an HTTP-date Retry-After on 503", async () => {
    const clock = Date.parse("2026-10-21T00:00:00Z");
    const spy = spyAgent();
    spy.mock.get("https://down.example").intercept({ path: "/" }).reply(503, "", {
      headers: { "retry-after": "Wed, 21 Oct 2026 00:00:30 GMT" },
    });
    const guard = guardWith(spy, { now: () => clock });
    await guard.fetch("https://down.example/");
    expect((await refusal(guard.fetch("https://down.example/"))).retryAt).toBe(clock + 30_000);
  });

  it("returns 304 and HEAD with no body", async () => {
    const spy = spyAgent();
    spy.mock.get("https://public.example").intercept({ path: "/feed", headers: { "if-none-match": '"v1"' } }).reply(304, "");
    const res = await guardWith(spy).fetch("https://public.example/feed", { headers: { "if-none-match": '"v1"' } });
    expect(res.status).toBe(304);
    expect(res.body).toBeNull();
  });

  it("passes the caller's abort through as itself", async () => {
    const spy = spyAgent();
    spy.mock.get("https://slow.example").intercept({ path: "/" }).reply(200, "late").delay(500);
    const controller = new AbortController();
    const pending = guardWith(spy).fetch("https://slow.example/", { signal: controller.signal });
    controller.abort(new Error("caller gave up"));
    await expect(pending).rejects.toThrow("caller gave up");
  });

  it("calls an unreachable host a network failure, not a refusal", async () => {
    const spy = spyAgent();
    spy.mock.get("https://public.example").intercept({ path: "/" }).replyWithError(new Error("ECONNRESET"));
    const err = await refusal(guardWith(spy).fetch("https://public.example/"));
    expect(err.code).toBe("network");
    expect(followMessage(err)).toBe("We couldn't reach that address");
    expect((await refusal(guardWith(spy).fetch("https://nowhere.invalid/"))).code).toBe("unresolvable_host");
  });
});

describe("fixtures and replay", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const feed: HttpFixture = {
    url: "https://hub.example/feed?since=2026-07-01",
    status: 200,
    headers: { "content-type": "application/json", etag: '"v1"' },
    body: '{"items":[]}',
  };
  const notModified: HttpFixture = {
    url: feed.url,
    requestHeaders: { "if-none-match": '"v1"' },
    status: 304,
    headers: {},
    body: "",
  };

  it("writes one readable file per request, grouped by host", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixtures-"));
    dirs.push(dir);
    const file = saveFixture(dir, feed);
    expect(path.relative(dir, file)).toMatch(/^hub\.example\/get_feed_since_2026_07_01-[0-9a-f]{10}\.json$/);
    expect(fixturePath(dir, notModified)).not.toBe(file);
    saveFixture(dir, notModified);
    expect(loadFixtures(dir)).toHaveLength(2);
  });

  it("replays through the real guard: checks still apply and unknown requests fail", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixtures-"));
    dirs.push(dir);
    saveFixture(dir, feed);
    saveFixture(dir, notModified);
    const guard = createFetchGuard(replayOptions(dir));

    const res = await guard.fetch(feed.url);
    expect(await res.json()).toEqual({ items: [] });
    expect(res.headers.get("etag")).toBe('"v1"');
    expect((await guard.fetch(feed.url, { headers: { "if-none-match": '"v1"' } })).status).toBe(304);
    expect((await refusal(guard.fetch("https://hub.example/other"))).code).toBe("no_fixture");
    expect((await refusal(guard.fetch("https://unrecorded.example/"))).code).toBe("unresolvable_host");
    expect((await refusal(guard.fetch("https://127.0.0.1/"))).code).toBe("blocked_address");
  });

  it("turns a response into a fixture without cookies or connection headers", async () => {
    const response = new Response("hi", {
      status: 200,
      headers: { "content-type": "text/plain", "set-cookie": "a=b", date: "now", etag: "x" },
    });
    expect(await fixtureFromResponse(response, { url: "https://hub.example/" })).toEqual({
      url: "https://hub.example/",
      status: 200,
      headers: { "content-type": "text/plain", etag: "x" },
      body: "hi",
    });
  });

  it("exposes the replay pieces for unit tests that build their own guard", async () => {
    const guard = createFetchGuard({ dispatcher: mockAgentFromFixtures([feed]), resolver: fixtureResolver([feed]) });
    expect((await guard.fetch(feed.url)).status).toBe(200);
  });
});
