import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/context.js";
import { hasFollowOrigin, MANUAL, originValues, resetFollowOriginCheck, SEED } from "../../src/river/following/origin.js";

// Where a follow came from (migration follow_origin): the code reads the column's presence first,
// so it keeps working while the migration hasn't landed (CLAUDE.md "Database").

/** A Db whose information_schema answers `present`, counting the reads. */
function fakeDb(present: () => boolean): Db & { reads: number } {
  const db = {
    reads: 0,
    async query() {
      db.reads++;
      return { rows: present() ? [{ "?column?": 1 }] : [], rowCount: present() ? 1 : 0, command: "SELECT", oid: 0, fields: [] };
    },
  };
  return db as unknown as Db & { reads: number };
}

afterEach(() => resetFollowOriginCheck());

describe("hasFollowOrigin", () => {
  it("says no on the old schema and asks again only after a minute", async () => {
    let present = false;
    const db = fakeDb(() => present);
    expect(await hasFollowOrigin(db, 1_000)).toBe(false);
    expect(await hasFollowOrigin(db, 30_000)).toBe(false);
    expect(db.reads).toBe(1);
    present = true;
    expect(await hasFollowOrigin(db, 61_001)).toBe(true);
    expect(db.reads).toBe(2);
  });

  it("once yes, never asks again", async () => {
    const db = fakeDb(() => true);
    expect(await hasFollowOrigin(db, 0)).toBe(true);
    expect(await hasFollowOrigin(db, 10 * 60_000)).toBe(true);
    expect(db.reads).toBe(1);
  });
});

describe("originValues", () => {
  it("is origin, ref and label, in column order", () => {
    expect(originValues(MANUAL)).toEqual(["manual", null, null]);
    expect(originValues(SEED)).toEqual(["seed", null, null]);
    expect(originValues({ origin: "bluesky_import", ref: "did:plc:lr36xv2l64jwtnyoaqem6z2z", label: "eff.org" })).toEqual([
      "bluesky_import",
      "did:plc:lr36xv2l64jwtnyoaqem6z2z",
      "eff.org",
    ]);
    expect(originValues({ origin: "bluesky_import", ref: "did:plc:x" })).toEqual(["bluesky_import", "did:plc:x", null]);
  });
});
