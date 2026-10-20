import { describe, expect, it } from "vitest";
import type { QueryResult } from "pg";
import { forAccount, forIdentity, forInstance, type ClientSource, type TxClient } from "../../src/db/context.js";

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
    const result = await forInstance("inst-1", (db) => db.query("SELECT 1 AS ok"), source);
    expect(result.rows).toEqual([{ ok: 1 }]);
    expect(calls).toEqual([
      { text: "BEGIN", values: undefined },
      { text: "SELECT set_config($1, $2, true)", values: ["app.instance_id", "inst-1"] },
      { text: "SELECT 1 AS ok", values: undefined },
      { text: "COMMIT", values: undefined },
    ]);
    expect(released).toEqual([undefined]);
  });

  it("forAccount sets both settings and never splices ids into SQL", async () => {
    const { source, calls } = fakeSource();
    const id = "acct'; DROP TABLE x; --";
    await forAccount("inst-1", id, (db) => db.query("SELECT $1::text", [id]), source);
    expect(calls[1]).toEqual({
      text: "SELECT set_config($1, $2, true), set_config($3, $4, true)",
      values: ["app.instance_id", "inst-1", "app.account_id", id],
    });
    for (const call of calls) expect(call.text).not.toContain("DROP");
  });

  it("forIdentity opens a transaction with no settings yet", async () => {
    const { source, calls } = fakeSource();
    await forIdentity(async () => "done", source);
    expect(calls.map((c) => c.text)).toEqual(["BEGIN", "COMMIT"]);
  });

  it("rolls back and rethrows when the callback throws", async () => {
    const { source, calls, released } = fakeSource();
    await expect(
      forInstance("inst-1", async () => {
        throw new Error("boom");
      }, source),
    ).rejects.toThrow("boom");
    expect(calls.map((c) => c.text).slice(-1)).toEqual(["ROLLBACK"]);
    expect(released).toEqual([undefined]);
  });

  it("destroys the client when the rollback fails", async () => {
    const { source, released } = fakeSource({ failOn: "ROLLBACK" });
    await expect(
      forInstance("inst-1", async () => {
        throw new Error("boom");
      }, source),
    ).rejects.toThrow("boom");
    expect(released[0]).toBeInstanceOf(Error);
  });

  it("refuses empty ids before connecting", async () => {
    const { source, calls } = fakeSource();
    await expect(forInstance("", async () => 1, source)).rejects.toThrow(/instanceId/);
    await expect(forAccount("inst-1", " ", async () => 1, source)).rejects.toThrow(/accountId/);
    expect(calls).toEqual([]);
  });
});
