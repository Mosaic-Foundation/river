// The identity schema as identity_app (never postgres): its row-level security, its grants and the
// lookups that run before a person is known (migration 20261021140000_identity_tables.sql), plus
// person creation and recover-dids against the real tables (checks 27's identity part, 28, 37).
// The recovery key pair here is generated at test time; no private key is ever committed.
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { forIdentity, forInstance, type Db } from "../../../src/db/context.js";
import { IDENTITY_TABLES } from "../../../src/db/tables.js";
import { parseJsonl, verifyLog } from "../../../src/identity/did/index.js";
import { EmailInUseError, RequestGoneError, createPerson, newWebauthnUserId } from "../../../src/identity/people.js";
import { recoveryKeyFromPem, type RecoveryKey } from "../../../src/identity/recovery/key.js";
import { recoverPerson } from "../../../src/identity/recovery/recoverDids.js";
import { createToken, hashToken, insertAuthRequest, lookups, randomToken, readDidLog } from "../../../src/identity/store.js";
import { IDENTITY_URL, RIVER_URL, SEED_INSTANCE, refusal, requireDatabase, rolePool } from "./roles.js";

const identity = rolePool(IDENTITY_URL);
const river = rolePool(RIVER_URL);

const ORIGIN = "http://localhost:3001";
const CLIENT = { clientId: "http://localhost:5173", redirectUri: "http://localhost:5173/api/auth/callback" };

function newRecoveryKey(): RecoveryKey {
  const pem = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  return recoveryKeyFromPem(pem);
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
      }).then(() => undefined),
    identity,
  );
  return id;
}

function fakeCredential() {
  return { id: randomBytes(32).toString("base64url"), publicKey: randomBytes(77), counter: 0, transports: ["internal"] };
}

async function makePerson(recovery: RecoveryKey, email = `db-${randomBytes(4).toString("hex")}@example.test`) {
  const credential = fakeCredential();
  const created = await createPerson(
    {
      origin: ORIGIN,
      recoveryMultikey: recovery.multikey,
      email,
      webauthnUserId: newWebauthnUserId(),
      credential,
      requestId: await newRequest(),
      now: new Date(Date.now() - 5_000),
    },
    identity,
  );
  return { ...created, credentialId: credential.id };
}

async function count(db: Db, table: string): Promise<number> {
  return (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.${table}`)).rows[0].n;
}

const recovery = newRecoveryKey();
let a: Awaited<ReturnType<typeof makePerson>>;
let b: Awaited<ReturnType<typeof makePerson>>;

beforeAll(async () => {
  vi.stubEnv("IDENTITY_MASTER_KEY", randomBytes(32).toString("base64"));
  await requireDatabase(identity, "identity_app");
  await requireDatabase(river, "river_app");
  a = await makePerson(recovery);
  b = await makePerson(recovery);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await identity.end();
  await river.end();
});

describe("identity schema catalog", () => {
  it("has exactly the spec 3.2 tables, each with ENABLE and FORCE RLS and policies for identity_app only", async () => {
    const { rows } = await identity.query(
      `SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
              array(SELECT DISTINCT r.rolname FROM pg_policy p CROSS JOIN LATERAL unnest(p.polroles) o
                     JOIN pg_roles r ON r.oid = o WHERE p.polrelid = c.oid)::text[] AS roles
         FROM pg_class c WHERE c.relnamespace = 'identity'::regnamespace AND c.relkind IN ('r', 'p') ORDER BY 1`,
    );
    expect(rows.map((r) => r.name)).toEqual([...IDENTITY_TABLES].sort());
    for (const row of rows) expect(row, row.name).toMatchObject({ enabled: true, forced: true, roles: ["identity_app"] });
  });

  it("identity_app may SELECT and INSERT, never DELETE; UPDATE only the columns flows change", async () => {
    const { rows } = await identity.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'identity_app' AND table_schema = 'identity' ORDER BY 1, 2`,
    );
    const grants = rows.map((r) => `${r.table_name}:${r.privilege_type}`);
    expect(grants.filter((g) => g.endsWith(":DELETE") || g.endsWith(":TRUNCATE") || g.endsWith(":UPDATE"))).toEqual([]);
    for (const table of IDENTITY_TABLES) expect(grants).toEqual(expect.arrayContaining([`${table}:INSERT`, `${table}:SELECT`]));
    const columns = await identity.query(
      `SELECT table_name, column_name FROM information_schema.column_privileges
        WHERE grantee = 'identity_app' AND table_schema = 'identity' AND privilege_type = 'UPDATE' ORDER BY 1, 2`,
    );
    expect(columns.rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([
      "auth_requests.pending",
      "auth_requests.used_at",
      "auth_requests.webauthn_challenge",
      "keys.retired_at",
      "passkeys.counter",
      "passkeys.last_used_at",
      "people.display_name",
      "people.email",
      "people.email_verified_at",
      "recovery_tokens.used_at",
    ]);
  });

  it("check 27: river_app can read no identity table and call no identity function", async () => {
    for (const table of IDENTITY_TABLES) {
      const { code, message } = await refusal(() =>
        forInstance(SEED_INSTANCE, (db) => db.query(`SELECT * FROM identity.${table}`), river),
      );
      expect(code, table).toBe("42501");
      expect(message).toMatch(/permission denied for schema identity/);
    }
    const call = await refusal(() => river.query("SELECT identity.person_by_code('abcdefgh')"));
    expect(call.code).toBe("42501");
  });
});

describe("row-level security as identity_app", () => {
  it("no settings: no row in any table", async () => {
    const seen = await forIdentity({}, async (db) => {
      const out: Record<string, number> = {};
      for (const table of IDENTITY_TABLES) out[table] = await count(db, table);
      return out;
    }, identity);
    expect(Object.values(seen).every((n) => n === 0)).toBe(true);
  });

  it("a person's context sees only that person's rows", async () => {
    const seen = await forIdentity({ personId: a.person.id }, async (db) => ({
      people: (await db.query("SELECT id FROM identity.people")).rows.map((r) => r.id),
      passkeys: (await db.query("SELECT DISTINCT person_id FROM identity.passkeys")).rows.map((r) => r.person_id),
      did_log: (await db.query("SELECT DISTINCT person_id FROM identity.did_log")).rows.map((r) => r.person_id),
      keys: (await db.query("SELECT DISTINCT person_id FROM identity.keys")).rows.map((r) => r.person_id),
      audit: (await db.query("SELECT DISTINCT person_id FROM identity.audit_log")).rows.map((r) => r.person_id),
      tokens: (await db.query("SELECT DISTINCT person_id FROM identity.recovery_tokens")).rows.map((r) => r.person_id),
      requests: await count(db, "auth_requests"),
      bByEmail: (await db.query("SELECT id FROM identity.people WHERE email = $1", [b.person.email])).rows,
    }), identity);
    const only = [a.person.id];
    expect(seen).toEqual({ people: only, passkeys: only, did_log: only, keys: only, audit: only, tokens: only, requests: 0, bByEmail: [] });
  });

  it("A's context can't write B's rows: inserts are refused, updates match nothing", async () => {
    const insert = await refusal(() =>
      forIdentity({ personId: a.person.id }, (db) =>
        db.query(
          "INSERT INTO identity.passkeys (person_id, credential_id, public_key) VALUES ($1, $2, $3)",
          [b.person.id, fakeCredential().id, randomBytes(10)],
        ), identity),
    );
    expect(insert.code).toBe("42501");
    expect(insert.message).toMatch(/row-level security/);
    const updated = await forIdentity({ personId: a.person.id }, (db) =>
      db.query("UPDATE identity.people SET email_verified_at = now() WHERE id = $1", [b.person.id]), identity);
    expect(updated.rowCount).toBe(0);
  });

  it("an auth request is reachable only by its own id", async () => {
    const id = await newRequest();
    const other = await newRequest();
    const seen = await forIdentity({ authRequestId: id }, async (db) =>
      (await db.query("SELECT id FROM identity.auth_requests")).rows.map((r) => r.id), identity);
    expect(seen).toEqual([id]);
    const forged = await refusal(() =>
      forIdentity({ authRequestId: id }, (db) =>
        db.query(
          `INSERT INTO identity.auth_requests (id, purpose, client_id, redirect_uri, state, nonce, webauthn_challenge, expires_at)
           VALUES ($1, 'authorize', 'x', 'y', 'z', 'w', $2, now() + interval '5 minutes')`,
          [randomUUID(), randomToken()],
        ), identity),
    );
    expect(forged.code).toBe("42501");
    void other;
  });

  it("did_log is append-only and key material can't be rewritten", async () => {
    for (const sql of [
      "UPDATE identity.did_log SET entry = entry WHERE person_id = $1",
      "DELETE FROM identity.did_log WHERE person_id = $1",
      "UPDATE identity.keys SET private_key_ciphertext = private_key_ciphertext WHERE person_id = $1",
      "DELETE FROM identity.keys WHERE person_id = $1",
      "DELETE FROM identity.audit_log WHERE person_id = $1",
      "DELETE FROM identity.people WHERE id = $1",
    ]) {
      const { code } = await refusal(() => forIdentity({ personId: a.person.id }, (db) => db.query(sql, [a.person.id]), identity));
      expect(code, sql).toBe("42501");
    }
  });

  it("the lookups return an id (or a yes/no) and nothing else", async () => {
    const found = await forIdentity({}, async (db) => ({
      byCredential: await lookups.personByCredential(db, a.credentialId),
      byCode: await lookups.personByCode(db, a.person.code),
      unknownCode: await lookups.personByCode(db, "zzzzzzzz"),
      // Not verified yet: no recovery for this address.
      forRecovery: await lookups.personForRecovery(db, a.person.email),
      inUse: await lookups.emailInUse(db, a.person.email.toUpperCase()),
      free: await lookups.emailInUse(db, "nobody@example.test"),
      byToken: await lookups.personByToken(db, hashToken(a.verifyToken)),
    }), identity);
    expect(found).toEqual({
      byCredential: a.person.id,
      byCode: a.person.id,
      unknownCode: undefined,
      forRecovery: undefined,
      inUse: true,
      free: false,
      byToken: a.person.id,
    });
  });
});

describe("creating a person", () => {
  it("writes the DID log, the sealed key, the passkey, the audit trail and a hashed verify token", async () => {
    const rows = await forIdentity({ personId: a.person.id }, async (db) => ({
      log: await readDidLog(db, a.person.id),
      keys: (await db.query("SELECT kid, retired_at FROM identity.keys")).rows,
      audit: (await db.query("SELECT action, detail FROM identity.audit_log ORDER BY at, action")).rows.map((r) => r.action as string),
      tokens: (await db.query("SELECT purpose, email, token_hash FROM identity.recovery_tokens")).rows,
    }), identity);
    const verified = await verifyLog(parseJsonl(rows.log.join("\n")));
    expect(verified.did).toBe(a.person.did);
    expect(verified.meta.scid).toBe(a.person.scid);
    expect(verified.meta.updateKeys[1]).toBe(recovery.multikey);
    expect(rows.keys).toEqual([{ kid: `${a.person.did}#key-1`, retired_at: null }]);
    expect(rows.audit.sort()).toEqual(["did_created", "key_used", "key_used", "passkey_added", "signin"].sort());
    expect(rows.tokens).toHaveLength(1);
    expect(rows.tokens[0]).toMatchObject({ purpose: "verify_email", email: a.person.email });
    expect(Buffer.from(rows.tokens[0].token_hash).equals(hashToken(a.verifyToken))).toBe(true);
    expect(JSON.stringify(rows.tokens)).not.toContain(a.verifyToken);
    expect(a.redirect).toMatch(/^http:\/\/localhost:5173\/api\/auth\/callback\?state=.+&note=.+\..+\..+$/);
  });

  it("a used request can't create another person, and an address can't have two", async () => {
    const requestId = await newRequest();
    const input = {
      origin: ORIGIN,
      recoveryMultikey: recovery.multikey,
      email: `twice-${randomBytes(4).toString("hex")}@example.test`,
      webauthnUserId: newWebauthnUserId(),
      credential: fakeCredential(),
      requestId,
      now: new Date(Date.now() - 1000),
    };
    await createPerson(input, identity);
    await expect(createPerson({ ...input, credential: fakeCredential(), webauthnUserId: newWebauthnUserId() }, identity)).rejects.toBeInstanceOf(RequestGoneError);
    await expect(
      createPerson({ ...input, requestId: await newRequest(), credential: fakeCredential(), webauthnUserId: newWebauthnUserId() }, identity),
    ).rejects.toBeInstanceOf(EmailInUseError);
  });

  it("stores only the SHA-256 of an emailed token", async () => {
    const token = await forIdentity({ personId: b.person.id }, (db) =>
      createToken(db, { personId: b.person.id, purpose: "recover", now: new Date() }), identity);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await forIdentity({ personId: b.person.id }, (db) =>
      db.query("SELECT token_hash FROM identity.recovery_tokens WHERE purpose = 'recover'"), identity);
    expect(stored.rows.map((r) => Buffer.from(r.token_hash).toString("hex"))).toEqual([hashToken(token).toString("hex")]);
  });
});

describe("recover-dids (check 37)", () => {
  it("appends an entry signed by the recovery key; the log verifies; SCID, DID and passkeys stay", async () => {
    const person = await makePerson(recovery);
    const done = await recoverPerson(person.person.code, recovery, { source: identity });
    expect(done).toMatchObject({ code: person.person.code, did: person.person.did, scid: person.person.scid, versionNumber: 2 });

    const after = await forIdentity({ personId: person.person.id }, async (db) => ({
      log: await readDidLog(db, person.person.id),
      keys: (await db.query("SELECT retired_at IS NULL AS active FROM identity.keys ORDER BY created_at")).rows.map((r) => r.active),
      passkeys: await count(db, "passkeys"),
      audit: (await db.query("SELECT detail FROM identity.audit_log WHERE action = 'did_recovered'")).rows.map((r) => r.detail),
    }), identity);
    const log = parseJsonl(after.log.join("\n"));
    expect(log).toHaveLength(2);
    expect(log[0].parameters.updateKeys).toHaveLength(2);
    expect(log[1].proof?.[0].verificationMethod).toBe(`did:key:${recovery.multikey}#${recovery.multikey}`);
    const verified = await verifyLog(log);
    expect(verified.meta.scid).toBe(person.person.scid);
    expect(verified.did).toBe(person.person.did);
    expect(verified.meta.updateKeys).toEqual([done.newKey, recovery.multikey]);
    expect(after.keys).toEqual([false, true]);
    expect(after.passkeys).toBe(1);
    expect(after.audit).toEqual([{ version: 2, key: `${person.person.did}#key-1` }]);
  });

  it("a key that isn't the DID's recovery key changes nothing", async () => {
    const person = await makePerson(recovery);
    await expect(recoverPerson(person.person.code, newRecoveryKey(), { source: identity })).rejects.toThrow(/doesn't list this recovery key/);
    const log = await forIdentity({ personId: person.person.id }, (db) => readDidLog(db, person.person.id), identity);
    expect(log).toHaveLength(1);
  });
});
