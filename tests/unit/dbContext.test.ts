import { describe, expect, it } from "vitest";
import type { QueryResult } from "pg";
import {
  ForeignIdError,
  forAccount,
  forHost,
  forIdentity,
  forInstance,
  stampRow,
  type ClientSource,
  type TxClient,
} from "../../src/db/context.js";

const INST = "00000000-0000-4000-8000-000000000001";
const OTHER_INST = "00000000-0000-4000-8000-0000000000e2";
const ACCT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCT = "22222222-2222-4222-8222-222222222222";

interface Call {
  text: string;
  values?: unknown[];
}

// A fake pool that records every query; no database needed.
function fakeSource(options: { failOn?: string } = {}) {
  const calls: Call[] = [];
  const released: Array<Error | boolean | undefined> = [];
  const client: TxClient = {
    async query(text, values) {
      calls.push({ text, values });
      if (options.failOn && text.startsWith(options.failOn)) throw new Error(`fail ${text}`);
      // An INSERT ... RETURNING * echoes its values back, keyed by the column list.
      const insert = /^INSERT INTO river\."\w+" \(([^)]*)\)/.exec(text);
      if (insert && values) {
        const columns = insert[1].split(", ").map((c) => c.replaceAll('"', ""));
        const row = Object.fromEntries(columns.map((c, i) => [c, values[i]]));
        return { rows: [row], rowCount: 1 } as unknown as QueryResult;
      }
      return { rows: [{ ok: 1 }], rowCount: 1 } as unknown as QueryResult;
    },
    release(destroy) {
      released.push(destroy);
    },
  };
  const source: ClientSource = { connect: async () => client };
  return { source, calls, released };
}

describe("db context", () => {
  it("forInstance sets app.instance_id as a bind parameter inside a transaction", async () => {
    const { source, calls, released } = fakeSource();
    const result = await forInstance(INST, (db) => db.query("SELECT 1 AS ok"), source);
    expect(result.rows).toEqual([{ ok: 1 }]);
    expect(calls).toEqual([
      { text: "BEGIN", values: undefined },
      { text: "SELECT set_config($1, $2, true)", values: ["app.instance_id", INST] },
      { text: "SELECT 1 AS ok", values: undefined },
      { text: "COMMIT", values: undefined },
    ]);
    expect(released).toEqual([undefined]);
  });

  it("forAccount sets both settings as bind parameters", async () => {
    const { source, calls } = fakeSource();
    await forAccount(INST, ACCT, (db) => db.query("SELECT $1::text", [ACCT]), source);
    expect(calls[1]).toEqual({
      text: "SELECT set_config($1, $2, true), set_config($3, $4, true)",
      values: ["app.instance_id", INST, "app.account_id", ACCT],
    });
    for (const call of calls) expect(call.text).not.toContain(ACCT);
  });

  it("refuses ids that are not uuids before connecting, so nothing can be spliced", async () => {
    const { source, calls } = fakeSource();
    const id = "acct'; DROP TABLE x; --";
    await expect(forAccount(INST, id, async () => 1, source)).rejects.toThrow(/accountId must be a uuid/);
    await expect(forInstance("inst-1", async () => 1, source)).rejects.toThrow(/instanceId must be a uuid/);
    expect(calls).toEqual([]);
  });

  it("lowercases ids, so a policy's uuid comparison and the stamp agree", async () => {
    const { source, calls } = fakeSource();
    await forInstance(INST.toUpperCase(), async () => 1, source);
    expect(calls[1].values).toEqual(["app.instance_id", INST]);
  });

  it("forHost opens a transaction with no settings", async () => {
    const { source, calls, released } = fakeSource();
    await forHost((db) => db.query("SELECT id FROM river.instances WHERE hostname = $1", ["x"]), source);
    expect(calls.map((c) => c.text)).toEqual([
      "BEGIN",
      "SELECT id FROM river.instances WHERE hostname = $1",
      "COMMIT",
    ]);
    expect(released).toEqual([undefined]);
  });

  it("forIdentity opens a transaction with no settings yet", async () => {
    const { source, calls } = fakeSource();
    await forIdentity(async () => "done", source);
    expect(calls.map((c) => c.text)).toEqual(["BEGIN", "COMMIT"]);
  });

  it("rolls back and rethrows when the callback throws", async () => {
    const { source, calls, released } = fakeSource();
    await expect(
      forInstance(INST, async () => {
        throw new Error("boom");
      }, source),
    ).rejects.toThrow("boom");
    expect(calls.map((c) => c.text).slice(-1)).toEqual(["ROLLBACK"]);
    expect(released).toEqual([undefined]);
  });

  it("destroys the client when the rollback fails", async () => {
    const { source, released } = fakeSource({ failOn: "ROLLBACK" });
    await expect(
      forInstance(INST, async () => {
        throw new Error("boom");
      }, source),
    ).rejects.toThrow("boom");
    expect(released[0]).toBeInstanceOf(Error);
  });

  it("refuses empty ids before connecting", async () => {
    const { source, calls } = fakeSource();
    await expect(forInstance("", async () => 1, source)).rejects.toThrow(/instanceId/);
    await expect(forAccount(INST, " ", async () => 1, source)).rejects.toThrow(/accountId/);
    expect(calls).toEqual([]);
  });

  it("insert stamps instance and account ids and binds every value", async () => {
    const { source, calls } = fakeSource();
    const row = await forAccount(
      INST,
      ACCT,
      (db) => db.insert("follows", { space_id: "s-1", rule: "follow" }),
      source,
    );
    expect(row).toEqual({ space_id: "s-1", rule: "follow", instance_id: INST, account_id: ACCT });
    expect(calls[2]).toEqual({
      text:
        'INSERT INTO river."follows" ("space_id", "rule", "instance_id", "account_id") ' +
        "VALUES ($1, $2, $3, $4) RETURNING *",
      values: ["s-1", "follow", INST, ACCT],
    });
  });

  it("insert refuses another instance's or account's payload and writes nothing", async () => {
    const { source, calls } = fakeSource();
    await expect(
      forAccount(INST, ACCT, (db) => db.insert("circles", { name: "x", account_id: OTHER_ACCT }), source),
    ).rejects.toBeInstanceOf(ForeignIdError);
    await expect(
      forAccount(INST, ACCT, (db) => db.insert("preferences", { key: "k", instance_id: OTHER_INST }), source),
    ).rejects.toThrow(/instance_id is not this context's/);
    await expect(
      forInstance(INST, (db) => db.insert("accounts", { instance_id: OTHER_INST }), source),
    ).rejects.toBeInstanceOf(ForeignIdError);
    expect(calls.filter((c) => c.text.startsWith("INSERT"))).toEqual([]);
    expect(calls.filter((c) => c.text === "ROLLBACK")).toHaveLength(3);
  });

  it("insert accepts the context's own ids, in any case", async () => {
    const { source } = fakeSource();
    const row = await forAccount(
      INST,
      ACCT,
      (db) => db.insert("read_state", { item_id: "i-1", account_id: ACCT.toUpperCase(), instance_id: INST }),
      source,
    );
    expect(row).toMatchObject({ instance_id: INST, account_id: ACCT });
  });

  it("stampRow follows each table's kind", () => {
    expect(stampRow("accounts", { display_name: "A" }, { instanceId: INST })).toEqual({
      display_name: "A",
      instance_id: INST,
    });
    expect(stampRow("circle_members", { circle_id: "c" }, { instanceId: INST, accountId: ACCT })).toEqual({
      circle_id: "c",
      instance_id: INST,
    });
    // Shared tables carry no instance; the reserved items.account_id stays null.
    expect(stampRow("spaces", { name: "S" }, { instanceId: INST, accountId: ACCT })).toEqual({ name: "S" });
    expect(stampRow("items", { account_id: null }, { instanceId: INST })).toEqual({ account_id: null });
    expect(() => stampRow("items", { account_id: ACCT }, { instanceId: INST })).toThrow(ForeignIdError);
    // A member's own table needs a member; operator config is migrations only.
    expect(() => stampRow("follows", {}, { instanceId: INST })).toThrow(/inside forAccount/);
    expect(() => stampRow("instances", {}, { instanceId: INST })).toThrow(/migrations only/);
  });

  it("insert refuses unknown tables and unsafe column names", async () => {
    const { source, calls } = fakeSource();
    await expect(
      forInstance(INST, (db) => db.insert("pg_authid" as never, { x: 1 }), source),
    ).rejects.toThrow(/Unknown river table/);
    await expect(
      forInstance(INST, (db) => db.insert("spaces", { 'name") VALUES (1); --': "x" }), source),
    ).rejects.toThrow(/Invalid column name/);
    expect(calls.filter((c) => c.text.startsWith("INSERT"))).toEqual([]);
  });
});
