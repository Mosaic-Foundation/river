// The acting tables (ADR-010; migration 20261027120000_acting_tables.sql), as river_app: each
// member reaches only their own linked accounts, attempts and actions, each instance only its own
// app registrations; no column that says whose row it is, or what was done, can be rewritten; a
// credential is whole or absent and held only by an active link; a sent act can't be deleted.
// Every change runs in a transaction that is rolled back (the callback throws).
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forAccount, forInstance, type RiverDb } from "../../../src/db/context.js";
import { OTHER_INSTANCE, RIVER_URL, SEED_INSTANCE, refusal, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

/** Runs `fn` as one member (or the instance, with null) and rolls it back; returns fn's value. */
async function rolledBack<T>(accountId: string | null, fn: (db: RiverDb) => Promise<T>, instance = SEED_INSTANCE): Promise<T> {
  try {
    const run = async (db: RiverDb) => {
      throw new Rollback(await fn(db));
    };
    if (accountId) await forAccount(instance, accountId, run, river);
    else await forInstance(instance, run, river);
  } catch (err) {
    if (err instanceof Rollback) return err.value as T;
    throw err;
  }
  throw new Error("unreachable");
}

async function newAccount(instance = SEED_INSTANCE): Promise<string> {
  const id = randomUUID();
  await forAccount(instance, id, (db) => db.insert("accounts", { id }), river);
  return id;
}

const sealed = () => ({ token_ciphertext: randomBytes(48), token_dek: randomBytes(60), token_key_version: 1 });

function link(db: RiverDb, overrides: Record<string, unknown> = {}) {
  return db.insert<{ id: string }>("linked_accounts", {
    kind: "fediverse",
    server_host: "example.social",
    actor_uri: `https://example.social/users/${randomUUID()}`,
    acct: "ana",
    ...sealed(),
    ...overrides,
  });
}

function act(db: RiverDb, overrides: Record<string, unknown> = {}) {
  return db.insert<{ id: string }>("member_actions", {
    channel: "fediverse",
    target_host: "example.social",
    verb: "post",
    limit_kind: "text",
    request: JSON.stringify({ method: "POST", url: "https://example.social/api/v1/statuses", fields: { status: "Hello" } }),
    session_epoch: 1,
    ...overrides,
  });
}

let member: string;
let other: string;
let otherLink: string;
let otherAction: string;

beforeAll(async () => {
  await requireDatabase(river, "river_app");
  member = await newAccount();
  other = await newAccount();
  // The other member's rows are committed, so the member's transactions could see them if RLS let them.
  [otherLink, otherAction] = await forAccount(
    SEED_INSTANCE,
    other,
    async (db) => {
      const l = await link(db);
      const a = await act(db, { linked_account_id: l.id });
      await db.insert("acting_attempts", { state: randomBytes(24).toString("base64url"), purpose: "fediverse_link", server_host: "example.social" });
      return [l.id, a.id];
    },
    river,
  );
});

afterAll(async () => {
  await river.end();
});

describe("acting tables: whose rows", () => {
  it("a member sees none of another member's linked accounts, attempts or actions (check 17, 20)", async () => {
    const counts = await rolledBack(member, async (db) => {
      const count = async (table: string) => (await db.query(`SELECT 1 FROM river.${table}`)).rowCount;
      return {
        links: await count("linked_accounts"),
        attempts: await count("acting_attempts"),
        actions: await count("member_actions"),
      };
    });
    expect(counts).toEqual({ links: 0, attempts: 0, actions: 0 });
    const own = await rolledBack(other, async (db) => (await db.query("SELECT id FROM river.member_actions")).rows.map((r) => r.id));
    expect(own).toEqual([otherAction]);
  });

  it("a member can't update or delete another member's rows (nothing matches)", async () => {
    const changed = await rolledBack(member, async (db) => [
      (await db.query("UPDATE river.linked_accounts SET status = 'unlinked', token_ciphertext = NULL, token_dek = NULL, token_key_version = NULL, revoked_at = now() WHERE id = $1", [otherLink])).rowCount,
      (await db.query("DELETE FROM river.linked_accounts WHERE id = $1", [otherLink])).rowCount,
      (await db.query("UPDATE river.member_actions SET status = 'failed' WHERE id = $1", [otherAction])).rowCount,
    ]);
    expect(changed).toEqual([0, 0, 0]);
  });

  it("a row naming another account is refused on insert", async () => {
    const { code } = await refusal(() =>
      rolledBack(member, (db) =>
        db.query(
          `INSERT INTO river.member_actions (instance_id, account_id, channel, target_host, verb, limit_kind, session_epoch)
           VALUES ($1, $2, 'fediverse', 'example.social', 'post', 'text', 1)`,
          [SEED_INSTANCE, other],
        ),
      ),
    );
    expect(code).toBe("42501");
  });

  it("an action can't point at another member's linked account or action", async () => {
    for (const column of ["linked_account_id", "undoes_id"]) {
      const target = column === "linked_account_id" ? otherLink : otherAction;
      const { code } = await refusal(() => rolledBack(member, (db) => act(db, { [column]: target })));
      expect(code, column).toBe("23503");
    }
  });

  it("app registrations are per instance", async () => {
    const host = `${randomUUID().slice(0, 8)}.example`;
    const client = {
      host,
      software: "mastodon",
      software_version: "4.3.0",
      client_id: "client-id",
      client_secret_ciphertext: randomBytes(48),
      client_secret_dek: randomBytes(60),
      key_version: 1,
      redirect_uri: "https://river.mosaic.social/api/auth/fediverse/callback",
      scopes: "profile write:statuses",
    };
    const seen = await rolledBack(null, async (db) => {
      await db.insert("oauth_clients", client);
      const here = (await db.query("SELECT host FROM river.oauth_clients WHERE host = $1", [host])).rowCount;
      // A second registration for the same server and instance is refused.
      const again = await db.query("SAVEPOINT s").then(() =>
        db.insert("oauth_clients", client).then(
          () => "inserted",
          (err: { code?: string }) => err.code,
        ),
      );
      return { here, again };
    });
    expect(seen).toEqual({ here: 1, again: "23505" });
    const elsewhere = await rolledBack(null, async (db) => (await db.query("SELECT 1 FROM river.oauth_clients")).rowCount, OTHER_INSTANCE);
    expect(elsewhere).toBe(0);
  });
});

describe("acting tables: what can change", () => {
  it.each([
    ["linked_accounts", "account_id"],
    ["linked_accounts", "kind"],
    ["linked_accounts", "actor_uri"],
    ["linked_accounts", "server_host"],
    ["member_actions", "account_id"],
    ["member_actions", "verb"],
    ["member_actions", "target_host"],
    ["member_actions", "session_epoch"],
    ["member_actions", "created_at"],
    ["member_actions", "undoes_id"],
    ["acting_attempts", "state"],
    ["acting_attempts", "account_id"],
    ["oauth_clients", "host"],
    ["oauth_clients", "client_secret_ciphertext"],
  ])("river_app can't update %s.%s", async (table, column) => {
    const { code, message } = await refusal(() =>
      rolledBack(table === "oauth_clients" ? null : other, (db) => db.query(`UPDATE river.${table} SET ${column} = ${column}`)),
    );
    expect(code).toBe("42501");
    expect(message).toMatch(/permission denied/);
  });

  it("an active link holds a whole credential; an ended one holds none", async () => {
    const results = await rolledBack(member, async (db) => {
      const attempt = async (overrides: Record<string, unknown>) => {
        await db.query("SAVEPOINT s");
        try {
          await link(db, overrides);
          await db.query("RELEASE SAVEPOINT s");
          return "ok";
        } catch (err) {
          await db.query("ROLLBACK TO SAVEPOINT s");
          return (err as { code?: string }).code;
        }
      };
      return {
        active: await attempt({}),
        activeWithout: await attempt({ token_ciphertext: null, token_dek: null, token_key_version: null }),
        halfSealed: await attempt({ token_dek: null }),
        shortDek: await attempt({ token_dek: randomBytes(32) }),
        unlinkedWithToken: await attempt({ status: "unlinked", revoked_at: new Date() }),
        unlinked: await attempt({ status: "unlinked", revoked_at: new Date(), token_ciphertext: null, token_dek: null, token_key_version: null }),
        unlinkedUndated: await attempt({ status: "unlinked", token_ciphertext: null, token_dek: null, token_key_version: null }),
      };
    });
    expect(results).toEqual({
      active: "ok",
      activeWithout: "23514",
      halfSealed: "23514",
      shortDek: "23514",
      unlinkedWithToken: "23514",
      unlinked: "ok",
      unlinkedUndated: "23514",
    });
  });

  it("unlinking deletes the credential and keeps the row", async () => {
    const row = await rolledBack(member, async (db) => {
      const { id } = await link(db);
      await db.query(
        `UPDATE river.linked_accounts
            SET status = 'unlinked', token_ciphertext = NULL, token_dek = NULL, token_key_version = NULL, revoked_at = now()
          WHERE id = $1`,
        [id],
      );
      return (await db.query("SELECT status, token_ciphertext FROM river.linked_accounts WHERE id = $1", [id])).rows[0];
    });
    expect(row).toEqual({ status: "unlinked", token_ciphertext: null });
  });

  it("each verb carries its limit kind (ADR-010 §9)", async () => {
    const results = await rolledBack(member, async (db) => {
      const attempt = async (verb: string, kind: string) => {
        await db.query("SAVEPOINT s");
        try {
          await act(db, { verb, limit_kind: kind });
          await db.query("RELEASE SAVEPOINT s");
          return true;
        } catch {
          await db.query("ROLLBACK TO SAVEPOINT s");
          return false;
        }
      };
      return {
        post: await attempt("post", "text"),
        comment: await attempt("comment", "text"),
        boost: await attempt("boost", "toggle"),
        unfavourite: await attempt("unfavourite", "toggle"),
        withdraw: await attempt("withdraw", "toggle"),
        unfollow: await attempt("unfollow", "follow"),
        delete: await attempt("delete", "delete"),
        postAsToggle: await attempt("post", "toggle"),
        deleteAsToggle: await attempt("delete", "toggle"),
        unknownVerb: await attempt("quote", "text"),
      };
    });
    expect(results).toEqual({
      post: true,
      comment: true,
      boost: true,
      unfavourite: true,
      withdraw: true,
      unfollow: true,
      delete: true,
      postAsToggle: false,
      deleteAsToggle: false,
      unknownVerb: false,
    });
  });

  it("a member may discard their own preview but not a sent act; erasing the text keeps the row", async () => {
    const results = await rolledBack(member, async (db) => {
      const preview = await act(db);
      const sent = await act(db);
      await db.query("UPDATE river.member_actions SET status = 'sent', sent_at = now() WHERE id = $1", [sent.id]);
      const deletedPreview = (await db.query("DELETE FROM river.member_actions WHERE id = $1", [preview.id])).rowCount;
      const deletedSent = (await db.query("DELETE FROM river.member_actions WHERE id = $1", [sent.id])).rowCount;
      await db.query("UPDATE river.member_actions SET request = NULL, subject_title = NULL, status = 'undone' WHERE id = $1", [sent.id]);
      const left = (await db.query("SELECT verb, target_host, status, request FROM river.member_actions WHERE id = $1", [sent.id])).rows[0];
      return { deletedPreview, deletedSent, left };
    });
    expect(results).toEqual({
      deletedPreview: 1,
      deletedSent: 0,
      left: { verb: "post", target_host: "example.social", status: "undone", request: null },
    });
  });

  it("an attempt is consumed once; its return path stays on the River", async () => {
    const results = await rolledBack(member, async (db) => {
      const state = randomBytes(24).toString("base64url");
      await db.insert("acting_attempts", { state, purpose: "grant", server_host: "id.mosaic.social", return_to: "/feed?x=1" });
      const consume = async () =>
        (
          await db.query(
            "UPDATE river.acting_attempts SET used_at = now() WHERE state = $1 AND used_at IS NULL AND created_at > now() - interval '10 minutes' RETURNING id",
            [state],
          )
        ).rowCount;
      const first = await consume();
      const second = await consume();
      const offsite = async (returnTo: string) => {
        await db.query("SAVEPOINT s");
        try {
          await db.insert("acting_attempts", {
            state: randomBytes(24).toString("base64url"),
            purpose: "grant",
            server_host: "id.mosaic.social",
            return_to: returnTo,
          });
          await db.query("RELEASE SAVEPOINT s");
          return "ok";
        } catch (err) {
          await db.query("ROLLBACK TO SAVEPOINT s");
          return (err as { code?: string }).code;
        }
      };
      return { first, second, protocolRelative: await offsite("//evil.example/"), backslash: await offsite("/\\evil.example"), absolute: await offsite("https://evil.example/") };
    });
    expect(results).toEqual({ first: 1, second: 0, protocolRelative: "23514", backslash: "23514", absolute: "23514" });
  });
});
