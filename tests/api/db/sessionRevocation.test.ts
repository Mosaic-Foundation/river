// Session revocation (migration 20261026201500_session_epoch, DECISIONS.md 2026-10-26): each
// session cookie carries its account's session epoch; "Sign out everywhere" raises the epoch, which
// ends every cookie issued before it. Cookies from before this change carry no epoch and are
// refused. The session middleware runs here as the server runs it, against the local database as
// river_app; the HTTP side (the route, Origin, the cookie it clears) is in tests/api/signin.test.ts.
import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { forAccount } from "../../../src/db/context.js";
import { closePool } from "../../../src/db/pool.js";
import { endAllSessions, signInAccount, type Viewer } from "../../../src/river/accounts.js";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, sign } from "../../../src/river/auth/cookies.js";
import { readSession, sessionCookie } from "../../../src/river/auth/session.js";
import { instanceForHost, type Instance } from "../../../src/river/instances.js";
import { RIVER_URL, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);
let instance: Instance;

beforeAll(async () => {
  vi.stubEnv("SESSION_SECRET", randomBytes(32).toString("base64url"));
  // readSession() reads accounts through the app's own pool, as river_app.
  vi.stubEnv("DATABASE_URL", RIVER_URL);
  await requireDatabase(river, "river_app");
  const found = await instanceForHost("river.mosaic.social", river);
  if (!found) throw new Error("seed instance missing");
  instance = found;
});

afterAll(async () => {
  await river.end();
  await closePool();
  vi.unstubAllEnvs();
});

/** A new member signing in with a new DID, and the session cookie the callback would set. */
async function signIn(scid: string = randomBytes(12).toString("hex")) {
  const account = await signInAccount(instance, { did: `did:webvh:${scid}:example.test`, scid }, river);
  return { ...account, scid, cookie: cookieValue(sessionCookie(instance.id, account.accountId, account.sessionEpoch)) };
}

/** `name=value` from a Set-Cookie header. */
function cookieValue(setCookie: string): string {
  return setCookie.split(";")[0]!;
}

/** Runs readSession() on a request carrying this cookie: the viewer, and whether it cleared the cookie. */
async function read(cookie: string): Promise<{ viewer: Viewer | undefined; cleared: boolean }> {
  const set: string[] = [];
  const req = { get: (name: string) => (name.toLowerCase() === "cookie" ? cookie : undefined) } as unknown as Request;
  const res = {
    locals: { instance },
    append: (name: string, value: string) => {
      if (name === "Set-Cookie") set.push(value);
    },
  } as unknown as Response;
  await new Promise<void>((resolve, reject) => void readSession()(req, res, (err?: unknown) => (err ? reject(err) : resolve())));
  return { viewer: res.locals.viewer as Viewer | undefined, cleared: set.some((c) => c.startsWith(`${SESSION_COOKIE}=;`)) };
}

describe("a session cookie carries its account's epoch", () => {
  it("a new account starts at epoch 1, and its cookie signs it in", async () => {
    const member = await signIn();
    expect(member.sessionEpoch).toBe(1);
    const { viewer, cleared } = await read(member.cookie);
    expect(viewer?.accountId).toBe(member.accountId);
    expect(cleared).toBe(false);
  });

  it("Sign out everywhere ends every earlier session; a new sign-in works", async () => {
    const first = await signIn();
    const second = await signIn(first.scid); // the same DID on another device
    expect(second.accountId).toBe(first.accountId);
    expect((await read(first.cookie)).viewer).toBeDefined();
    expect((await read(second.cookie)).viewer).toBeDefined();

    expect(await endAllSessions(instance.id, first.accountId, river)).toBe(2);
    for (const cookie of [first.cookie, second.cookie]) {
      const { viewer, cleared } = await read(cookie);
      expect(viewer).toBeUndefined();
      expect(cleared).toBe(true);
    }

    const again = await signIn(first.scid);
    expect(again.sessionEpoch).toBe(2);
    expect((await read(again.cookie)).viewer?.accountId).toBe(first.accountId);
  });

  it("refuses a cookie without an epoch (issued before this change)", async () => {
    const member = await signIn();
    const iat = Math.floor(Date.now() / 1000);
    const v1 = { v: 1, instance: instance.id, account: member.accountId, iat, exp: iat + SESSION_MAX_AGE_S };
    const raw = sign(process.env.SESSION_SECRET!, "session", Buffer.from(JSON.stringify(v1)).toString("base64url"));
    const { viewer, cleared } = await read(`${SESSION_COOKIE}=${raw}`);
    expect(viewer).toBeUndefined();
    expect(cleared).toBe(true);
  });

  it("refuses a cookie claiming a later epoch than the account's", async () => {
    const member = await signIn();
    const { viewer } = await read(cookieValue(sessionCookie(instance.id, member.accountId, member.sessionEpoch + 1)));
    expect(viewer).toBeUndefined();
  });

  it("one member can't raise another's epoch", async () => {
    const victim = await signIn();
    const other = randomUUID();
    await forAccount(instance.id, other, (db) => db.insert("accounts", { id: other }), river);
    const { rowCount } = await forAccount(
      instance.id,
      other,
      (db) => db.query("UPDATE river.accounts SET session_epoch = session_epoch + 1 WHERE id = $1", [victim.accountId]),
      river,
    );
    expect(rowCount).toBe(0);
    expect((await read(victim.cookie)).viewer).toBeDefined();
  });
});
