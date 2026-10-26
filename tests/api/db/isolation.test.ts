// Acceptance check 27: running as river_app (never postgres), member A's queries never return
// member B's follows, circles, read state or preferences, and river_app cannot read the identity
// schema. Every query here goes through forInstance()/forAccount() on a river_app pool, as the
// app's will, except where a test bypasses them on purpose to show the database alone holds.
//
// Each run makes its own accounts and space (random ids), so runs don't depend on each other.
// river_app can't delete accounts, so local rows pile up until `npx supabase db reset`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForeignIdError, forAccount, forInstance, type RiverDb } from "../../../src/db/context.js";
import { signInAccount } from "../../../src/river/accounts.js";
import type { Instance } from "../../../src/river/instances.js";
import {
  IDENTITY_URL,
  OTHER_INSTANCE,
  RIVER_URL,
  SEED_INSTANCE,
  refusal,
  requireDatabase,
  rolePool,
} from "./roles.js";

const river = rolePool(RIVER_URL);
const identity = rolePool(IDENTITY_URL);

const PERSONAL = ["follows", "circles", "circle_members", "read_state", "preferences"] as const;

interface Member {
  account: string;
  circle: string;
}
let a: Member;
let b: Member;
let spaceId: string;
let itemIds: string[];

/** One member's rows in every personal table: a follow, a circle with the space in it, a read mark and a preference. */
async function seedMember(db: RiverDb, item: string, label: string): Promise<string> {
  await db.insert("follows", { space_id: spaceId });
  const circle = await db.insert<{ id: string }>("circles", { name: `${label} circle`, color: "#000000" });
  await db.insert("circle_members", { circle_id: circle.id, space_id: spaceId });
  await db.insert("read_state", { item_id: item });
  await db.insert("preferences", { key: "mode", value: JSON.stringify(label) });
  return circle.id;
}

async function makeAccount(instance: string, name: string): Promise<string> {
  const row = await forInstance(instance, (db) => db.insert<{ id: string }>("accounts", { display_name: name }), river);
  return row.id;
}

/** Everything the member's context can see in each personal table, with no WHERE clause. */
async function visible(instance: string, account: string) {
  return forAccount(
    instance,
    account,
    async (db) => {
      const out: Record<string, Array<Record<string, unknown>>> = {};
      for (const table of [...PERSONAL, "accounts"]) {
        out[table] = (await db.query(`SELECT * FROM river.${table}`)).rows;
      }
      return out;
    },
    river,
  );
}

beforeAll(async () => {
  await requireDatabase(river, "river_app");
  await requireDatabase(identity, "identity_app");

  // A shared space with two items, written the way adapters will: inside an instance context.
  ({ spaceId, itemIds } = await forInstance(
    SEED_INSTANCE,
    async (db) => {
      const space = await db.insert<{ id: string }>("spaces", {
        adapter: "sample",
        canonical_url: `https://isolation.test/${randomUUID()}`,
        name: "Isolation test space",
        category: "club",
      });
      const ids: string[] = [];
      for (const n of [1, 2]) {
        const item = await db.insert<{ id: string }>("items", {
          space_id: space.id,
          source_id: `urn:isolation:${randomUUID()}`,
          kind: "post",
          published_at: new Date(),
          title: `Item ${n}`,
        });
        ids.push(item.id);
      }
      return { spaceId: space.id, itemIds: ids };
    },
    river,
  ));

  const accountA = await makeAccount(SEED_INSTANCE, "Member A");
  const accountB = await makeAccount(SEED_INSTANCE, "Member B");
  a = { account: accountA, circle: await forAccount(SEED_INSTANCE, accountA, (db) => seedMember(db, itemIds[0], "A"), river) };
  b = { account: accountB, circle: await forAccount(SEED_INSTANCE, accountB, (db) => seedMember(db, itemIds[1], "B"), river) };
});

afterAll(async () => {
  await river.end();
  await identity.end();
});

describe("check 27: member isolation as river_app", () => {
  it("member A sees only A's follows, circles, circle members, read state and preferences", async () => {
    const seen = await visible(SEED_INSTANCE, a.account);
    for (const table of ["follows", "circles", "read_state", "preferences"] as const) {
      expect(seen[table], table).toHaveLength(1);
      expect(seen[table][0], table).toMatchObject({ instance_id: SEED_INSTANCE, account_id: a.account });
    }
    expect(seen.circle_members).toEqual([{ instance_id: SEED_INSTANCE, circle_id: a.circle, space_id: spaceId }]);
    expect(seen.read_state[0].item_id).toBe(itemIds[0]);
    expect(seen.preferences[0].value).toBe("A");
    expect(seen.accounts.map((row) => row.id)).toEqual([a.account]);
  });

  it("member B sees only B's", async () => {
    const seen = await visible(SEED_INSTANCE, b.account);
    for (const table of ["follows", "circles", "read_state", "preferences"] as const) {
      expect(seen[table].map((row) => row.account_id), table).toEqual([b.account]);
    }
    expect(seen.circle_members.map((row) => row.circle_id)).toEqual([b.circle]);
    expect(seen.accounts.map((row) => row.id)).toEqual([b.account]);
  });

  it("asking for B's rows by id from A's context returns nothing", async () => {
    const rows = await forAccount(
      SEED_INSTANCE,
      a.account,
      async (db) => ({
        follows: (await db.query("SELECT * FROM river.follows WHERE account_id = $1", [b.account])).rows,
        circles: (await db.query("SELECT * FROM river.circles WHERE id = $1", [b.circle])).rows,
        members: (await db.query("SELECT * FROM river.circle_members WHERE circle_id = $1", [b.circle])).rows,
        read: (await db.query("SELECT * FROM river.read_state WHERE item_id = $1", [itemIds[1]])).rows,
        account: (await db.query("SELECT * FROM river.accounts WHERE id = $1", [b.account])).rows,
      }),
      river,
    );
    expect(rows).toEqual({ follows: [], circles: [], members: [], read: [], account: [] });
  });

  it("A can't change or delete B's rows: the statements match nothing", async () => {
    const counts = await forAccount(
      SEED_INSTANCE,
      a.account,
      async (db) => ({
        update: (await db.query("UPDATE river.follows SET rule = 'mute' WHERE account_id = $1", [b.account])).rowCount,
        rename: (await db.query("UPDATE river.circles SET name = 'taken' WHERE id = $1", [b.circle])).rowCount,
        unread: (await db.query("DELETE FROM river.read_state WHERE account_id = $1", [b.account])).rowCount,
        prefs: (await db.query("DELETE FROM river.preferences WHERE account_id = $1", [b.account])).rowCount,
        members: (await db.query("DELETE FROM river.circle_members WHERE circle_id = $1", [b.circle])).rowCount,
      }),
      river,
    );
    expect(counts).toEqual({ update: 0, rename: 0, unread: 0, prefs: 0, members: 0 });
    const seen = await visible(SEED_INSTANCE, b.account);
    expect(seen.follows[0].rule).toBe("follow");
    expect(seen.circles[0].name).toBe("B circle");
    expect(seen.read_state).toHaveLength(1);
    expect(seen.preferences).toHaveLength(1);
    expect(seen.circle_members).toHaveLength(1);
  });

  it("forAccount refuses a payload carrying B's account id before it reaches the database", async () => {
    await expect(
      forAccount(SEED_INSTANCE, a.account, (db) => db.insert("preferences", { key: "x", value: "1", account_id: b.account }), river),
    ).rejects.toBeInstanceOf(ForeignIdError);
    await expect(
      forAccount(SEED_INSTANCE, a.account, (db) => db.insert("follows", { space_id: spaceId, instance_id: OTHER_INSTANCE }), river),
    ).rejects.toBeInstanceOf(ForeignIdError);
  });

  it("the database refuses the same writes made with plain SQL (row-level security alone)", async () => {
    const asA = (sql: string, values: unknown[]) =>
      refusal(() => forAccount(SEED_INSTANCE, a.account, (db) => db.query(sql, values), river));

    const insertForB = await asA(
      "INSERT INTO river.preferences (account_id, key, value) VALUES ($1, 'x', '1')",
      [b.account],
    );
    const moveToB = await asA("UPDATE river.circles SET account_id = $1 WHERE id = $2", [b.account, a.circle]);
    const joinBsCircle = await asA(
      "INSERT INTO river.circle_members (circle_id, space_id) VALUES ($1, $2)",
      [b.circle, spaceId],
    );
    const otherInstance = await asA(
      "INSERT INTO river.read_state (instance_id, item_id) VALUES ($1, $2)",
      [OTHER_INSTANCE, itemIds[1]],
    );
    for (const result of [insertForB, moveToB, joinBsCircle, otherInstance]) {
      expect(result.code).toBe("42501");
      expect(result.message).toMatch(/violates row-level security policy/);
    }
  });

  it("an instance context without an account sees no member's rows, only its own accounts", async () => {
    const seen = await forInstance(
      SEED_INSTANCE,
      async (db) => {
        const out: Record<string, number> = {};
        for (const table of PERSONAL) {
          out[table] = (await db.query(`SELECT * FROM river.${table}`)).rows.length;
        }
        const accounts = await db.query("SELECT DISTINCT instance_id FROM river.accounts");
        out.accountInstances = accounts.rows.length;
        out.foreignAccounts = accounts.rows.filter((r) => r.instance_id !== SEED_INSTANCE).length;
        return out;
      },
      river,
    );
    expect(seen).toEqual({
      follows: 0,
      circles: 0,
      circle_members: 0,
      read_state: 0,
      preferences: 0,
      accountInstances: 1,
      foreignAccounts: 0,
    });
  });

  it("A's account id under another instance sees nothing and can write nothing", async () => {
    const seen = await visible(OTHER_INSTANCE, a.account);
    for (const table of [...PERSONAL, "accounts"]) expect(seen[table], table).toEqual([]);

    // The stamp says OTHER_INSTANCE, and A is no account of it: the composite key refuses it.
    const { code, message } = await refusal(() =>
      forAccount(
        OTHER_INSTANCE,
        a.account,
        async (db) => {
          const space = await db.insert<{ id: string }>("spaces", {
            adapter: "sample",
            canonical_url: `https://isolation.test/${randomUUID()}`,
            name: "Another space",
          });
          return db.insert("follows", { space_id: space.id });
        },
        river,
      ),
    );
    expect(code).toBe("23503");
    expect(message).toMatch(/follows_instance_id_account_id_fkey/);
  });

  it("a member of another instance is invisible here", async () => {
    const other = await makeAccount(OTHER_INSTANCE, "Member C");
    const fromSeed = await forInstance(
      SEED_INSTANCE,
      (db) => db.query("SELECT * FROM river.accounts WHERE id = $1", [other]),
      river,
    );
    expect(fromSeed.rows).toEqual([]);
  });

  it("shared spaces and items are readable by every member, and by nobody outside a context", async () => {
    for (const member of [a, b]) {
      const { rows } = await forAccount(
        SEED_INSTANCE,
        member.account,
        (db) => db.query("SELECT id FROM river.items WHERE space_id = $1 ORDER BY title", [spaceId]),
        river,
      );
      expect(rows.map((r) => r.id)).toEqual(itemIds);
    }
    // Straight on the pool, skipping forInstance()/forAccount(): no settings, no rows.
    for (const table of ["spaces", "items", "streams", "accounts", ...PERSONAL]) {
      const { rows } = await river.query(`SELECT count(*)::int AS n FROM river.${table}`);
      expect(rows[0].n, table).toBe(0);
    }
  });

  it("river_app cannot read the identity schema, and identity_app cannot read the river schema", async () => {
    const intoIdentity = await refusal(() =>
      forAccount(SEED_INSTANCE, a.account, (db) => db.query("SELECT * FROM identity.people"), river),
    );
    expect(intoIdentity.code).toBe("42501");
    expect(intoIdentity.message).toMatch(/permission denied for schema identity/);

    const intoRiver = await refusal(() => identity.query("SELECT * FROM river.follows"));
    expect(intoRiver.code).toBe("42501");
    expect(intoRiver.message).toMatch(/permission denied for schema river/);
  });
});

// M8: real sign-ups (the callback's own signInAccount(), seeds copied) and the two sign-in tables.
describe("check 27 with real sign-ups, and the sign-in tables", () => {
  let instance: Instance;
  let c: { accountId: string; scid: string };
  let d: { accountId: string; scid: string };
  const scid = () => `Qm${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    const row = await forInstance(
      SEED_INSTANCE,
      async (db) => (await db.query("SELECT * FROM river.instances WHERE id = $1", [SEED_INSTANCE])).rows[0],
      river,
    );
    instance = {
      id: row.id,
      hostname: row.hostname,
      name: row.name,
      theme: row.theme,
      modesEnabled: row.modes_enabled,
      defaultMode: row.default_mode,
      seedFollows: row.seed_follows,
      defaultCircles: row.default_circles,
      plugins: row.plugins,
    };
    for (const assign of [(v: typeof c) => (c = v), (v: typeof d) => (d = v)]) {
      const id = scid();
      const made = await signInAccount(instance, { did: `did:webvh:${id}:id.example:u:abcdefgh`, scid: id }, river);
      expect(made.created).toBe(true);
      assign({ accountId: made.accountId, scid: id });
    }
  });

  it("each new member sees only their own copied follows, circles and login method", async () => {
    const seenC = await visible(SEED_INSTANCE, c.accountId);
    const seenD = await visible(SEED_INSTANCE, d.accountId);
    expect(seenC.follows.length).toBeGreaterThan(0);
    expect(seenC.circles.length).toBe(instance.defaultCircles.length);
    for (const table of ["follows", "circles"] as const) {
      expect(seenC[table].every((r) => r.account_id === c.accountId), table).toBe(true);
      expect(seenD[table].every((r) => r.account_id === d.accountId), table).toBe(true);
    }
    const cCircles = new Set(seenC.circles.map((r) => r.id));
    expect(seenC.circle_members.every((r) => cCircles.has(r.circle_id))).toBe(true);
    expect(seenD.circle_members.some((r) => cCircles.has(r.circle_id))).toBe(false);

    const logins = await forAccount(SEED_INSTANCE, c.accountId, (db) => db.query("SELECT * FROM river.login_methods"), river);
    expect(logins.rows.map((r) => [r.account_id, r.scid])).toEqual([[c.accountId, c.scid]]);
  });

  it("signing in again finds the same account by SCID, on this instance only", async () => {
    const again = await signInAccount(instance, { did: `did:webvh:${c.scid}:moved.example:u:abcdefgh`, scid: c.scid }, river);
    expect(again).toEqual({ accountId: c.accountId, created: false, sessionEpoch: 1 });
    // The stored DID follows a move (same SCID).
    const logins = await forAccount(SEED_INSTANCE, c.accountId, (db) => db.query("SELECT did FROM river.login_methods"), river);
    expect(logins.rows).toEqual([{ did: `did:webvh:${c.scid}:moved.example:u:abcdefgh` }]);
    const lookup = (instanceId: string) =>
      forInstance(instanceId, async (db) => (await db.query("SELECT river.account_for_login('did', $1) AS id", [c.scid])).rows[0].id, river);
    expect(await lookup(SEED_INSTANCE)).toBe(c.accountId);
    expect(await lookup(OTHER_INSTANCE)).toBeNull();
  });

  it("login methods are invisible to other members and to an instance context, and can't be moved", async () => {
    const fromD = await forAccount(
      SEED_INSTANCE,
      d.accountId,
      async (db) => ({
        rows: (await db.query("SELECT * FROM river.login_methods WHERE scid = $1", [c.scid])).rows,
        update: (await db.query("UPDATE river.login_methods SET did = 'did:x' WHERE scid = $1", [c.scid])).rowCount,
      }),
      river,
    );
    expect(fromD).toEqual({ rows: [], update: 0 });
    const fromInstance = await forInstance(SEED_INSTANCE, (db) => db.query("SELECT * FROM river.login_methods"), river);
    expect(fromInstance.rows).toEqual([]);
    const move = await refusal(() =>
      forAccount(SEED_INSTANCE, c.accountId, (db) => db.query("UPDATE river.login_methods SET account_id = $1", [d.accountId]), river),
    );
    expect(move.code).toBe("42501");
    // A second account can't take the same SCID on this instance.
    const dup = await refusal(() =>
      forAccount(SEED_INSTANCE, d.accountId, (db) => db.insert("login_methods", { kind: "did", did: "did:webvh:x", scid: c.scid }), river),
    );
    expect(dup.code).toBe("23505");
  });

  it("auth_attempts: river_app inserts for its own instance, can't read them, and consumes one once", async () => {
    const state = randomUUID().replaceAll("-", "") + "state";
    const nonce = randomUUID().replaceAll("-", "") + "nonce";
    await forInstance(SEED_INSTANCE, (db) => db.query("INSERT INTO river.auth_attempts (state, nonce) VALUES ($1, $2)", [state, nonce]), river);

    const read = await refusal(() => forInstance(SEED_INSTANCE, (db) => db.query("SELECT * FROM river.auth_attempts"), river));
    expect(read.code).toBe("42501");
    const change = await refusal(() =>
      forInstance(SEED_INSTANCE, (db) => db.query("UPDATE river.auth_attempts SET used_at = NULL"), river),
    );
    expect(change.code).toBe("42501");
    const foreign = await refusal(() =>
      forInstance(
        SEED_INSTANCE,
        (db) => db.query("INSERT INTO river.auth_attempts (state, nonce, instance_id) VALUES ($1, $2, $3)", [`${state}x`, nonce, OTHER_INSTANCE]),
        river,
      ),
    );
    expect(foreign.message).toMatch(/row-level security/);

    const consume = (instanceId: string) =>
      forInstance(instanceId, async (db) => (await db.query("SELECT river.consume_auth_attempt($1) AS nonce", [state])).rows[0].nonce, river);
    expect(await consume(OTHER_INSTANCE)).toBeNull();
    expect(await consume(SEED_INSTANCE)).toBe(nonce);
    expect(await consume(SEED_INSTANCE)).toBeNull();
  });
});
