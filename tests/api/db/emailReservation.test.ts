// Mosaic ID email reservation (security review of 3a86e8f, item 5; migration
// 20261026163500_email_reservation.sql). Only a verified address is held; unverified sign-ups may
// share one, whoever verifies first keeps it, and the daily job releases an address still
// unverified 24 hours on. Right after a recovery the person may remove their other passkeys, and
// only then. People are made as identity_app through createPerson(), as the other identity tests
// do; the confirm link and sign-up options go over HTTP to the identity dev server
// (`npm run dev:identity`), because that is where those answers are decided.
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { forIdentity } from "../../../src/db/context.js";
import { CONFIRM_WARNING } from "../../../src/identity/email/messages.js";
import { esc } from "../../../src/identity/pages.js";
import { createPerson, newWebauthnUserId } from "../../../src/identity/people.js";
import { recoveryKeyFromPem } from "../../../src/identity/recovery/key.js";
import {
  consumeAuthRequest,
  insertAuthRequest,
  insertPasskey,
  lookups,
  otherPasskeys,
  randomToken,
  removeOtherPasskey,
} from "../../../src/identity/store.js";
import { ADMIN_URL, IDENTITY_URL, requireDatabase, rolePool } from "./roles.js";

const identity = rolePool(IDENTITY_URL);
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const ID = process.env.IDENTITY_API_URL ?? "http://localhost:3001";
const CLIENT = { clientId: "http://localhost:5173", redirectUri: "http://localhost:5173/api/auth/callback" };
// A recovery key pair made for this run only; no private key is ever committed.
const RECOVERY_MULTIKEY = recoveryKeyFromPem(
  generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
).multikey;
const MINUTE = 60_000;

beforeAll(async () => {
  vi.stubEnv("IDENTITY_MASTER_KEY", randomBytes(32).toString("base64"));
  await requireDatabase(identity, "identity_app");
  await fetch(`${ID}/test/rate-limits/reset`, { method: "POST" });
});

afterAll(async () => {
  await identity.end();
  await admin.end();
});

function address(label: string): string {
  return `${label}-${randomBytes(4).toString("hex")}@example.test`;
}

async function newRequest(): Promise<string> {
  const id = randomUUID();
  await forIdentity(
    { authRequestId: id },
    (db) =>
      insertAuthRequest(db, {
        id,
        purpose: "authorize",
        client: { ...CLIENT, state: randomToken(), nonce: randomToken() },
        challenge: randomToken(),
        now: new Date(),
      }),
    identity,
  );
  return id;
}

function fakeCredential() {
  return { id: randomBytes(32).toString("base64url"), publicKey: randomBytes(77), counter: 0, transports: ["internal"] };
}

async function signUp(email: string, displayName?: string) {
  const credential = fakeCredential();
  const created = await createPerson(
    {
      origin: ID,
      recoveryMultikey: RECOVERY_MULTIKEY,
      email,
      displayName,
      webauthnUserId: newWebauthnUserId(),
      credential,
      requestId: await newRequest(),
      now: new Date(Date.now() - 5_000),
    },
    identity,
  );
  return { ...created, credentialId: credential.id };
}

function confirm(token: string): Promise<Response> {
  return fetch(`${ID}/verify`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ID },
    body: new URLSearchParams({ token }).toString(),
  });
}

async function verifiedAt(personId: string): Promise<{ email: string | null; email_verified_at: Date | null }> {
  const { rows } = await admin.query("SELECT email, email_verified_at FROM identity.people WHERE id = $1", [personId]);
  return rows[0];
}

const inUse = (email: string) => forIdentity({}, (db) => lookups.emailInUse(db, email), identity);

describe("only a verified address is held", () => {
  it("two sign-ups may name one address; neither keeps anyone else from it", async () => {
    const email = address("shared");
    const first = await signUp(email);
    const second = await signUp(email);
    expect(first.person.id).not.toBe(second.person.id);
    expect(await inUse(email)).toBe(false);
  });

  it("whoever confirms first keeps it; the other's link is refused", async () => {
    const email = address("race");
    const squatter = await signUp(email, "Squatter");
    const owner = await signUp(email, "Owner");

    const won = await confirm(owner.verifyToken);
    expect(won.status).toBe(200);
    expect(await inUse(email)).toBe(true);
    expect(await forIdentity({}, (db) => lookups.personForRecovery(db, email), identity)).toBe(owner.person.id);

    const lost = await confirm(squatter.verifyToken);
    expect(lost.status).toBe(409);
    expect(await lost.text()).toContain("Another Mosaic ID confirmed that address first.");
    expect((await verifiedAt(squatter.person.id)).email_verified_at).toBeNull();
  });

  it("sign-up step 1 answers the same for a taken address as for a free one", async () => {
    const email = address("taken");
    const owner = await signUp(email);
    expect((await confirm(owner.verifyToken)).status).toBe(200);
    const page = await fetch(
      `${ID}/authorize?${new URLSearchParams({ client_id: CLIENT.clientId, redirect_uri: CLIENT.redirectUri, state: randomToken(), nonce: randomToken() })}`,
    );
    const request = /data-request="([0-9a-f-]{36})"/.exec(await page.text())?.[1];
    const shapes: string[] = [];
    for (const candidate of [email, address("free")]) {
      const res = await fetch(`${ID}/authorize/signup/options`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ID },
        body: JSON.stringify({ request, email: candidate }),
      });
      expect(res.status, candidate).toBe(200);
      const body = (await res.json()) as { options: Record<string, unknown> };
      shapes.push(JSON.stringify([Object.keys(body).sort(), Object.keys(body.options).sort()]));
    }
    expect(shapes[0]).toBe(shapes[1]);
  });
});

describe("the confirm page", () => {
  it("says who started it and what to do if it wasn't you, with the display name escaped", async () => {
    const someone = await signUp(address("page"), "Eve <b>");
    const res = await fetch(`${ID}/verify?token=${someone.verifyToken}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(esc(CONFIRM_WARNING.signup));
    expect(html).toContain("The Mosaic ID gave the name “Eve &lt;b&gt;”.");
    expect(html).not.toContain("<b>");
    // Confirming is still a deliberate press of the one button.
    expect(html).toContain('<button type="submit">Confirm my address</button>');
    expect((await verifiedAt(someone.person.id)).email_verified_at).toBeNull();
  });
});

describe("the daily job releases unverified addresses", () => {
  it("clears an address still unverified 24 hours after sign-up, and never a verified one", async () => {
    const idle = await signUp(address("idle"));
    const kept = await signUp(address("kept"));
    expect((await confirm(kept.verifyToken)).status).toBe(200);
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      const at = (await client.query<{ at: Date }>("SELECT now() + interval '25 hours' AS at")).rows[0]!.at;
      const summary = (await client.query<{ r: Record<string, number> }>("SELECT river.daily_job($1) AS r", [at])).rows[0]!.r;
      expect(summary.released_addresses).toBeGreaterThanOrEqual(1);
      const rows = (
        await client.query<{ id: string; email: string | null }>("SELECT id, email FROM identity.people WHERE id = ANY($1)", [[idle.person.id, kept.person.id]])
      ).rows;
      expect(rows.find((r) => r.id === idle.person.id)?.email).toBeNull();
      expect(rows.find((r) => r.id === kept.person.id)?.email).toBe(kept.person.email);
      // A verified Mosaic ID always has its address.
      await client.query("SAVEPOINT s");
      await expect(client.query("UPDATE identity.people SET email = NULL WHERE id = $1", [kept.person.id])).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT s");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("a sign-up a day old keeps its address until then", async () => {
    const fresh = await signUp(address("fresh"));
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT river.daily_job(now() + interval '23 hours')");
      expect((await client.query("SELECT email FROM identity.people WHERE id = $1", [fresh.person.id])).rows[0].email).toBe(fresh.person.email);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("removing other passkeys after a recovery", () => {
  /** A person with `extra` more passkeys, and a recover request that added the last of them at `usedAt`. */
  async function recovered(extra: number, usedAt: Date) {
    const person = await signUp(address("recovered"));
    const added: string[] = [];
    for (let i = 0; i < extra; i++) {
      const credential = fakeCredential();
      await forIdentity({ personId: person.person.id }, (db) => insertPasskey(db, person.person.id, credential, new Date()), identity);
      added.push(credential.id);
    }
    const newCredential = added[added.length - 1]!;
    const request = randomUUID();
    await forIdentity(
      { personId: person.person.id, authRequestId: request },
      async (db) => {
        await insertAuthRequest(db, { id: request, purpose: "recover", personId: person.person.id, challenge: randomToken(), now: usedAt });
        await consumeAuthRequest(db, request, usedAt);
        await db.query("UPDATE identity.auth_requests SET pending = jsonb_build_object('new_credential_id', $2::text) WHERE id = $1", [request, newCredential]);
      },
      identity,
    );
    const ids = await forIdentity({ personId: person.person.id }, async (db) => {
      const { rows } = await db.query<{ id: string; credential_id: string }>("SELECT id, credential_id FROM identity.passkeys");
      return new Map(rows.map((r) => [r.credential_id, r.id]));
    }, identity);
    return { personId: person.person.id, request, original: ids.get(person.credentialId)!, added: added.map((c) => ids.get(c)!), newCredential };
  }

  it("removes another passkey for 10 minutes after the recovery, never the new one, never someone else's", async () => {
    const now = new Date();
    const r = await recovered(1, now);
    const asRecovered = <T>(fn: Parameters<typeof forIdentity<T>>[1]) => forIdentity({ personId: r.personId, authRequestId: r.request }, fn, identity);

    const listed = await forIdentity({ personId: r.personId }, (db) => otherPasskeys(db, r.personId, r.newCredential), identity);
    expect(listed.map((p) => p.id)).toEqual([r.original]);

    // Never the passkey the recovery added, and not another person's.
    expect(await asRecovered((db) => removeOtherPasskey(db, r.added[0]!, now))).toBe(false);
    const stranger = await recovered(1, now);
    expect(await asRecovered((db) => removeOtherPasskey(db, stranger.original, now))).toBe(false);
    // Not without the recover request in the transaction's settings.
    expect(await forIdentity({ personId: r.personId }, (db) => removeOtherPasskey(db, r.original, now), identity)).toBe(false);

    expect(await asRecovered((db) => removeOtherPasskey(db, r.original, new Date(now.getTime() + MINUTE)))).toBe(true);
    const left = await forIdentity({ personId: r.personId }, async (db) => (await db.query("SELECT id FROM identity.passkeys")).rows.map((x) => x.id), identity);
    expect(left).toEqual([r.added[0]]);
  });

  it("refuses once 10 minutes have passed", async () => {
    const usedAt = new Date();
    const r = await recovered(1, usedAt);
    const late = new Date(usedAt.getTime() + 11 * MINUTE);
    expect(await forIdentity({ personId: r.personId, authRequestId: r.request }, (db) => removeOtherPasskey(db, r.original, late), identity)).toBe(false);
  });

  it("identity_app still has no DELETE on passkeys", async () => {
    const r = await recovered(1, new Date());
    await expect(
      forIdentity({ personId: r.personId }, (db) => db.query("DELETE FROM identity.passkeys WHERE id = $1", [r.original]), identity),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
