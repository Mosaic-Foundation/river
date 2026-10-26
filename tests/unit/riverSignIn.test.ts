// The River's sign-in callback checks (spec 4.6 step 4; check 11, unit half), the DID resolver
// (through the fetch guard in production, loopback only in test mode) and the signed cookies.
// Notes are signed with test keys against test DID logs built by didwebvh-ts, the same library the
// identity host uses; no request leaves the process.
import { randomBytes, type KeyObject } from "node:crypto";
import { MockAgent } from "undici";
import { beforeAll, describe, expect, it } from "vitest";
import { appendKeyRotation, createPersonDid, toJsonl } from "../../src/identity/did/index.js";
import { generateEd25519, signEd25519, toMultikey } from "../../src/identity/keys/ed25519.js";
import {
  DID_CACHE_MS,
  DidResolver,
  didLogUrl,
  isTrustedHost,
  parseWebvhDid,
  type WebvhDid,
} from "../../src/river/auth/did.js";
import { FRESH_INTERVAL_S, FreshReads, NoteError, verifySignInNote, type VerifyDeps } from "../../src/river/auth/note.js";
import {
  cookieHeader,
  decodeSession,
  encodeSession,
  readCookie,
  sign,
  unsign,
} from "../../src/river/auth/cookies.js";
import { createFetchGuard, isLoopbackHttpUrl, loopbackFetch, FetchError } from "../../src/shared/fetch/index.js";

const AUD = "https://river.example";
const TRUSTED = ["id.example", "localhost:3005"];
const NOW = 1_800_000_000;

interface TestKey {
  privateKey: KeyObject;
  multikey: string;
  sign: (data: Uint8Array) => Promise<Buffer>;
}

function key(): TestKey {
  const pair = generateEd25519();
  return { privateKey: pair.privateKey, multikey: toMultikey(pair.publicKey), sign: async (d) => signEd25519(pair.privateKey, d) };
}

interface TestDid {
  did: string;
  scid: string;
  person: TestKey;
  recovery: TestKey;
  jsonl: string;
}

async function testDid(origin: string, code = "abcdefgh"): Promise<TestDid> {
  const person = key();
  const recovery = key();
  const created = await createPersonDid({
    origin,
    code,
    personMultikey: person.multikey,
    recoveryMultikey: recovery.multikey,
    sign: person.sign,
    created: new Date(Date.now() - 60_000),
  });
  return { did: created.did, scid: created.scid, person, recovery, jsonl: toJsonl(created.log) };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function makeNote(
  signer: KeyObject,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${signEd25519(signer, Buffer.from(input, "ascii")).toString("base64url")}`;
}

function opaque(): string {
  return randomBytes(32).toString("base64url");
}

/** Serves DID logs by URL; counts requests. */
class LogServer {
  readonly logs = new Map<string, string>();
  requests: string[] = [];
  async fetch(url: string): Promise<Response> {
    this.requests.push(url);
    const body = this.logs.get(url);
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 });
  }
}

let trusted: TestDid;
let untrusted: TestDid;
let server: LogServer;
let resolver: DidResolver;
let attempts: Map<string, { nonce: string; used: boolean }>;
let freshReads: FreshReads;

beforeAll(async () => {
  trusted = await testDid("http://localhost:3005");
  untrusted = await testDid("http://localhost:3006");
});

function freshWorld(): void {
  server = new LogServer();
  server.logs.set(`http://localhost:3005/u/abcdefgh/did.jsonl`, trusted.jsonl);
  server.logs.set(`http://localhost:3006/u/abcdefgh/did.jsonl`, untrusted.jsonl);
  resolver = new DidResolver({ allowLoopback: true, loopback: (url) => server.fetch(url) });
  attempts = new Map();
  freshReads = new FreshReads();
}

function deps(overrides: Partial<VerifyDeps> = {}): VerifyDeps {
  return {
    consumeAttempt: async (state) => {
      const attempt = attempts.get(state);
      if (!attempt || attempt.used) return undefined;
      attempt.used = true;
      return attempt.nonce;
    },
    resolver,
    audience: AUD,
    trustedHosts: TRUSTED,
    now: () => NOW,
    freshReads,
    ...overrides,
  };
}

/** A started sign-in and a good note for it; `change` edits the note's parts before signing. */
function attempt(
  change: {
    header?: Record<string, unknown>;
    payload?: Record<string, unknown>;
    signer?: KeyObject;
    who?: TestDid;
  } = {},
) {
  const who = change.who ?? trusted;
  const state = opaque();
  const nonce = opaque();
  attempts.set(state, { nonce, used: false });
  const header = { alg: "EdDSA", kid: `${who.did}#key-1`, ...change.header };
  const payload = { iss: who.did, sub: who.did, aud: AUD, nonce, iat: NOW - 5, exp: NOW + 115, ...change.payload };
  const note = makeNote(change.signer ?? who.person.privateKey, header, payload);
  return { state, nonce, note };
}

async function refused(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof NoteError) return err.reason;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("verifySignInNote: a good note", () => {

  it("returns the DID and SCID, and consumes the attempt once", async () => {
    freshWorld();
    const { state, note } = attempt();
    await expect(verifySignInNote({ state, note, cookieState: state }, deps())).resolves.toEqual({
      did: trusted.did,
      scid: trusted.scid,
    });
    expect(attempts.get(state)?.used).toBe(true);
    // The same state again: already used.
    expect(await refused(verifySignInNote({ state, note, cookieState: state }, deps()))).toBe("attempt");
  });

  it("accepts iat up to 60 s ahead and exp up to 60 s past", async () => {
    freshWorld();
    const a = attempt({ payload: { iat: NOW + 60, exp: NOW + 120 } });
    await expect(verifySignInNote({ state: a.state, note: a.note, cookieState: a.state }, deps())).resolves.toBeTruthy();
    const b = attempt({ payload: { iat: NOW - 170, exp: NOW - 60 } });
    await expect(verifySignInNote({ state: b.state, note: b.note, cookieState: b.state }, deps())).resolves.toBeTruthy();
  });

  it("caches the resolved log for 10 minutes", async () => {
    freshWorld();
    let now = NOW;
    resolver = new DidResolver({ allowLoopback: true, loopback: (url) => server.fetch(url), now: () => now * 1000 });
    for (let i = 0; i < 3; i++) {
      const a = attempt();
      await verifySignInNote({ state: a.state, note: a.note, cookieState: a.state }, deps());
    }
    expect(server.requests).toHaveLength(1);
    now += DID_CACHE_MS / 1000 + 1;
    const a = attempt({ payload: { iat: now - 5, exp: now + 100 } });
    await verifySignInNote({ state: a.state, note: a.note, cookieState: a.state }, deps({ now: () => now }));
    expect(server.requests).toHaveLength(2);
  });

  it("after recover-dids, verifies with the new key from the CURRENT document, even with the old one cached", async () => {
    freshWorld();
    const first = attempt();
    await verifySignInNote({ state: first.state, note: first.note, cookieState: first.state }, deps());

    // The recovery key re-keys the DID (as npm run recover-dids does); the log grows one entry.
    const created = await testDidLogFrom(trusted);
    const next = key();
    const rotated = await appendKeyRotation({
      log: created,
      signerMultikey: trusted.recovery.multikey,
      sign: trusted.recovery.sign,
      newMultikey: next.multikey,
      recoveryMultikey: trusted.recovery.multikey,
      updated: new Date(),
    });
    server.logs.set(`http://localhost:3005/u/abcdefgh/did.jsonl`, toJsonl(rotated.log));

    const after = attempt({ signer: next.privateKey });
    await expect(
      verifySignInNote({ state: after.state, note: after.note, cookieState: after.state }, deps()),
    ).resolves.toEqual({ did: trusted.did, scid: trusted.scid });
    // The cached document didn't verify the note, so the log was read once more.
    expect(server.requests).toHaveLength(2);

    // The old key no longer signs in (a minute on, when the DID may be read fresh again).
    const old = attempt();
    const later = deps({ now: () => NOW + FRESH_INTERVAL_S });
    expect(await refused(verifySignInNote({ state: old.state, note: old.note, cookieState: old.state }, later))).toBe(
      "signature",
    );
    server.logs.set(`http://localhost:3005/u/abcdefgh/did.jsonl`, trusted.jsonl);
  });
});

describe("verifySignInNote: fresh DID reads (security review item 4)", () => {
  it("reads a DID's log fresh at most once a minute, however many bad notes arrive", async () => {
    freshWorld();
    const good = attempt();
    await verifySignInNote({ state: good.state, note: good.note, cookieState: good.state }, deps());
    expect(server.requests).toHaveLength(1);

    const stranger = key().privateKey;
    const reasons: string[] = [];
    for (let i = 0; i < 20; i++) {
      const bad = attempt({ signer: stranger });
      reasons.push(await refused(verifySignInNote({ state: bad.state, note: bad.note, cookieState: bad.state }, deps())));
    }
    // One fresh read for the first bad note; the rest are refused without a request.
    expect(reasons[0]).toBe("signature");
    expect(reasons.slice(1).every((r) => r === "fresh_limited")).toBe(true);
    expect(server.requests).toHaveLength(2);

    // A minute later the DID may be read fresh once more.
    const bad = attempt({ signer: stranger });
    const later = deps({ now: () => NOW + FRESH_INTERVAL_S });
    expect(await refused(verifySignInNote({ state: bad.state, note: bad.note, cookieState: bad.state }, later))).toBe("signature");
    expect(server.requests).toHaveLength(3);
  });
});

async function testDidLogFrom(did: TestDid) {
  return did.jsonl
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l));
}

describe("verifySignInNote: check 11, each refused", () => {
  it.each([
    ["wrong aud", { payload: { aud: "https://other.example" } }, "aud"],
    ["expired exp", { payload: { iat: NOW - 200, exp: NOW - 61 } }, "exp"],
    ["iat in the future", { payload: { iat: NOW + 61, exp: NOW + 181 } }, "iat"],
    ["mismatched nonce", { payload: { nonce: opaque() } }, "nonce"],
    ["alg none", { header: { alg: "none" } }, "alg"],
    ["alg ES256", { header: { alg: "ES256" } }, "alg"],
    ["alg eddsa (case)", { header: { alg: "eddsa" } }, "alg"],
    ["iss != sub", { payload: { sub: "did:webvh:QmSomeoneElse1234567890:localhost%3A3005:u:zzzzzzzz" } }, "iss_sub"],
    ["iss not a did:webvh", { payload: { iss: "https://id.example", sub: "https://id.example" } }, "iss_sub"],
    ["no kid", { header: { kid: undefined } }, "kid"],
    ["exp long after iat", { payload: { iat: NOW, exp: NOW + 3600 } }, "exp"],
  ] as const)("%s", async (_label, change, reason) => {
    freshWorld();
    const { state, note } = attempt(change as Parameters<typeof attempt>[0]);
    expect(await refused(verifySignInNote({ state, note, cookieState: state }, deps()))).toBe(reason);
  });

  it("a kid naming another DID", async () => {
    freshWorld();
    const { state, note } = attempt({ header: { kid: `${untrusted.did}#key-1` } });
    expect(await refused(verifySignInNote({ state, note, cookieState: state }, deps()))).toBe("kid");
    // A kid that only starts with the DID's text, without the '#', is refused too.
    const b = attempt({ header: { kid: `${trusted.did}x#key-1` } });
    expect(await refused(verifySignInNote({ state: b.state, note: b.note, cookieState: b.state }, deps()))).toBe("kid");
  });

  it("a kid the document doesn't list under authentication", async () => {
    freshWorld();
    const { state, note } = attempt({ header: { kid: `${trusted.did}#key-2` } });
    expect(await refused(verifySignInNote({ state, note, cookieState: state }, deps()))).toBe("no_key");
  });

  it("a signature by a different key, even one named in the header", async () => {
    freshWorld();
    const other = key();
    const { state, note } = attempt({
      signer: other.privateKey,
      header: { jwk: { kty: "OKP", crv: "Ed25519", x: "ignored" }, publicKeyMultibase: other.multikey },
    });
    expect(await refused(verifySignInNote({ state, note, cookieState: state }, deps()))).toBe("signature");
  });

  it("a tampered payload", async () => {
    freshWorld();
    const { state, note, nonce } = attempt();
    const [h, , s] = note.split(".");
    const forged = `${h}.${b64({ iss: untrusted.did, sub: untrusted.did, aud: AUD, nonce, iat: NOW, exp: NOW + 60 })}.${s}`;
    expect(await refused(verifySignInNote({ state, note: forged, cookieState: state }, deps({ trustedHosts: [...TRUSTED, "localhost:3006"] })))).toBe(
      "kid",
    );
  });

  it("a DID on a host not in TRUSTED_DID_HOSTS, with no request made", async () => {
    freshWorld();
    const { state, note } = attempt({ who: untrusted });
    expect(await refused(verifySignInNote({ state, note, cookieState: state }, deps()))).toBe("untrusted_host");
    expect(server.requests).toEqual([]);
  });

  it("an unknown state, or one already used", async () => {
    freshWorld();
    const { note } = attempt();
    const unknown = opaque();
    expect(await refused(verifySignInNote({ state: unknown, note, cookieState: unknown }, deps()))).toBe("attempt");
  });

  it("a missing or different state cookie, without spending the attempt", async () => {
    freshWorld();
    const { state, note } = attempt();
    expect(await refused(verifySignInNote({ state, note, cookieState: undefined }, deps()))).toBe("state_cookie");
    expect(await refused(verifySignInNote({ state, note, cookieState: opaque() }, deps()))).toBe("state_cookie");
    expect(attempts.get(state)?.used).toBe(false);
    // The right browser can still finish.
    await expect(verifySignInNote({ state, note, cookieState: state }, deps())).resolves.toBeTruthy();
  });

  it("a malformed note or state", async () => {
    freshWorld();
    for (const note of [undefined, "", "a.b", "a.b.c.d", "!!.!!.!!", ["x"], "x".repeat(9000)]) {
      const { state } = attempt();
      expect(await refused(verifySignInNote({ state, note, cookieState: state }, deps()))).toMatch(/malformed|alg/);
    }
    expect(await refused(verifySignInNote({ state: "short", note: "a.b.c", cookieState: "short" }, deps()))).toBe(
      "state_cookie",
    );
  });

  it("a log that doesn't resolve", async () => {
    freshWorld();
    server.logs.set(`http://localhost:3005/u/abcdefgh/did.jsonl`, trusted.jsonl.replace(/"versionId":"1-/, '"versionId":"2-'));
    const { state, note } = attempt();
    expect(await refused(verifySignInNote({ state, note, cookieState: state }, deps()))).toBe("resolve");
    server.logs.set(`http://localhost:3005/u/abcdefgh/did.jsonl`, trusted.jsonl);
    server.logs.delete(`http://localhost:3005/u/abcdefgh/did.jsonl`);
    const b = attempt();
    expect(await refused(verifySignInNote({ state: b.state, note: b.note, cookieState: b.state }, deps()))).toBe("resolve");
  });
});

describe("DID parsing", () => {
  it("reads did:webvh hosts with ports and paths", () => {
    const parsed = parseWebvhDid(trusted.did) as WebvhDid;
    expect(parsed).toMatchObject({ scid: trusted.scid, host: "localhost:3005", path: ["u", "abcdefgh"] });
    expect(didLogUrl(parsed)).toBe("https://localhost:3005/u/abcdefgh/did.jsonl");
    expect(didLogUrl(parseWebvhDid("did:webvh:QmScid1234567890abcdef:id.example") as WebvhDid)).toBe(
      "https://id.example/.well-known/did.jsonl",
    );
    expect(isTrustedHost(parsed, ["localhost:3005"])).toBe(true);
    // A host without the port is a different host.
    expect(isTrustedHost(parsed, ["localhost"])).toBe(false);
  });

  it.each([
    "did:web:id.example",
    "did:webvh:short:id.example",
    "did:webvh:QmScid1234567890abcdef:id.example:..:x",
    "did:webvh:QmScid1234567890abcdef:id.example%2Fevil",
    "did:webvh:QmScid1234567890abcdef:user@id.example",
    "did:webvh:QmScid1234567890abcdef:id.example%3A0",
    "did:webvh:QmScid1234567890abcdef:id.example:u:a%2Fb",
    "did:webvh:QmScid1234567890abcdef",
  ])("refuses %s", (did) => {
    expect(parseWebvhDid(did)).toBeUndefined();
  });
});

describe("DID resolution goes through the fetch guard", () => {
  it("production: https through the guard (MockAgent), never loopback", async () => {
    const remote = await testDid("https://id.example");
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent.get("https://id.example").intercept({ path: "/u/abcdefgh/did.jsonl" }).reply(200, remote.jsonl).persist();
    const guard = createFetchGuard({ dispatcher: agent, resolver: async () => [{ address: "93.184.215.14", family: 4 }] });
    const viaGuard = new DidResolver({ guard });
    const resolved = await viaGuard.resolve(parseWebvhDid(remote.did) as WebvhDid);
    expect(resolved).toMatchObject({ did: remote.did, scid: remote.scid, deactivated: false });
    await agent.close();
  });

  it("a loopback DID without test mode goes to the guard, which refuses it", async () => {
    let loopbackCalls = 0;
    const strict = new DidResolver({
      allowLoopback: false,
      loopback: async () => {
        loopbackCalls++;
        return new Response(trusted.jsonl);
      },
      guard: createFetchGuard({ dispatcher: new MockAgent(), resolver: async () => [{ address: "127.0.0.1", family: 4 }] }),
    });
    await expect(strict.resolve(parseWebvhDid(trusted.did) as WebvhDid)).rejects.toBeInstanceOf(FetchError);
    expect(loopbackCalls).toBe(0);
  });

  it("loopbackFetch refuses unless TEST_DID_LOOPBACK=1, and refuses anything but http://loopback:port", async () => {
    const before = process.env.TEST_DID_LOOPBACK;
    delete process.env.TEST_DID_LOOPBACK;
    await expect(loopbackFetch("http://localhost:3001/u/x/did.jsonl")).rejects.toMatchObject({ code: "not_https" });
    process.env.TEST_DID_LOOPBACK = "1";
    try {
      for (const url of [
        "http://example.org:3001/x",
        "https://localhost:3001/x",
        "http://localhost/x",
        "http://user:pw@localhost:3001/x",
        "http://10.0.0.5:3001/x",
        "http://localhost:3001/x?y=1",
      ]) {
        expect(isLoopbackHttpUrl(url), url).toBe(false);
        await expect(loopbackFetch(url), url).rejects.toMatchObject({ code: "blocked_address" });
      }
      expect(isLoopbackHttpUrl("http://localhost:3001/u/abcdefgh/did.jsonl")).toBe(true);
      expect(isLoopbackHttpUrl("http://127.0.0.1:3001/did.jsonl")).toBe(true);
    } finally {
      if (before === undefined) delete process.env.TEST_DID_LOOPBACK;
      else process.env.TEST_DID_LOOPBACK = before;
    }
  });
});

describe("the River's cookies", () => {
  const secret = "s".repeat(64);

  it("signs and checks values per purpose", () => {
    const signed = sign(secret, "signin-state", "abc");
    expect(unsign(secret, "signin-state", signed)).toBe("abc");
    expect(unsign(secret, "session", signed)).toBeUndefined();
    expect(unsign("t".repeat(64), "signin-state", signed)).toBeUndefined();
    expect(unsign(secret, "signin-state", `${signed}x`)).toBeUndefined();
    expect(unsign(secret, "signin-state", "abc")).toBeUndefined();
    expect(() => sign("short", "session", "x")).toThrow(/SESSION_SECRET/);
  });

  it("sessions expire and must be well formed", () => {
    const token = { v: 2 as const, instance: "00000000-0000-4000-8000-000000000001", account: "00000000-0000-4000-8000-0000000000aa", epoch: 1, iat: NOW, exp: NOW + 100 };
    const raw = encodeSession(secret, token);
    expect(decodeSession(secret, raw, NOW + 50)).toEqual(token);
    expect(decodeSession(secret, raw, NOW + 100)).toBeUndefined();
    expect(decodeSession(secret, raw.replace(/^./, "x"), NOW)).toBeUndefined();
    expect(decodeSession(secret, sign(secret, "session", b64({ ...token, account: "not-a-uuid" })), NOW)).toBeUndefined();
  });

  it("sessions carry the account's session epoch; a cookie without one is refused (DECISIONS, 2026-10-26)", () => {
    const token = { v: 2 as const, instance: "00000000-0000-4000-8000-000000000001", account: "00000000-0000-4000-8000-0000000000aa", epoch: 3, iat: NOW, exp: NOW + 100 };
    expect(decodeSession(secret, encodeSession(secret, token), NOW)?.epoch).toBe(3);
    const { epoch: _epoch, ...noEpoch } = token;
    // The cookie every member held before this change: v1, no epoch.
    expect(decodeSession(secret, sign(secret, "session", b64({ ...noEpoch, v: 1 })), NOW)).toBeUndefined();
    expect(decodeSession(secret, sign(secret, "session", b64(noEpoch)), NOW)).toBeUndefined();
    for (const epoch of [0, -1, 1.5, "1", null]) {
      expect(decodeSession(secret, sign(secret, "session", b64({ ...token, epoch })), NOW), String(epoch)).toBeUndefined();
    }
  });

  it("are HttpOnly, Secure, SameSite=Lax and host-wide; a repeated name is trusted neither way", () => {
    expect(cookieHeader("__Host-river-session", "v", 10)).toBe(
      "__Host-river-session=v; Path=/; Max-Age=10; HttpOnly; Secure; SameSite=Lax",
    );
    expect(readCookie("a=1; __Host-river-session=x; b=2", "__Host-river-session")).toBe("x");
    expect(readCookie("__Host-river-session=x; __Host-river-session=y", "__Host-river-session")).toBeUndefined();
    expect(readCookie(undefined, "x")).toBeUndefined();
  });
});
