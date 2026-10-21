// forHost() and the hostname lookup (ADR-004, check 26), as river_app: with no settings, the
// lookup reads river.instances and nothing else.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { forHost } from "../../../src/db/context.js";
import { clearInstanceCache, instanceForHost, SEED_INSTANCE_ID } from "../../../src/river/instances.js";
import { OTHER_INSTANCE, RIVER_URL, SEED_INSTANCE, refusal, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);
const saved = { aliases: process.env.INSTANCE_HOST_ALIASES, vercelEnv: process.env.VERCEL_ENV };

beforeAll(async () => {
  await requireDatabase(river, "river_app");
});

afterEach(() => {
  clearInstanceCache();
  for (const [name, value] of [
    ["INSTANCE_HOST_ALIASES", saved.aliases],
    ["VERCEL_ENV", saved.vercelEnv],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

afterAll(async () => {
  await river.end();
});

describe("forHost()", () => {
  it("reads instances", async () => {
    const { rows } = await forHost((db) => db.query("SELECT id FROM river.instances ORDER BY id"), river);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([SEED_INSTANCE, OTHER_INSTANCE]));
  });

  it("sees no spaces, items, streams or accounts, and can't write any", async () => {
    const counts = await forHost(
      (db) =>
        db.query(
          `SELECT (SELECT count(*) FROM river.spaces)::int AS spaces, (SELECT count(*) FROM river.items)::int AS items,
                  (SELECT count(*) FROM river.streams)::int AS streams, (SELECT count(*) FROM river.accounts)::int AS accounts`,
        ),
      river,
    );
    expect(counts.rows[0]).toEqual({ spaces: 0, items: 0, streams: 0, accounts: 0 });
    const { code } = await refusal(() =>
      forHost(
        (db) => db.query("INSERT INTO river.spaces (adapter, canonical_url, name) VALUES ('sample', 'urn:x:forhost', 'x')"),
        river,
      ),
    );
    expect(code).toBe("42501");
  });
});

describe("instance by hostname (check 26)", () => {
  it("the seed instance's own hostname, any letter case or port", async () => {
    delete process.env.INSTANCE_HOST_ALIASES;
    delete process.env.VERCEL_ENV;
    expect((await instanceForHost("River.Mosaic.Social:443", river))?.id).toBe(SEED_INSTANCE_ID);
    expect((await instanceForHost("isolation-test.invalid", river))?.id).toBe(OTHER_INSTANCE);
  });

  it("aliases map to the seed instance; unknown hosts to nothing", async () => {
    process.env.INSTANCE_HOST_ALIASES = "localhost,river-preview.vercel.app";
    delete process.env.VERCEL_ENV;
    const seed = await instanceForHost("localhost", river);
    expect(seed).toMatchObject({ id: SEED_INSTANCE_ID, theme: "mosaic", defaultMode: "everything" });
    expect(seed?.seedFollows.length).toBeGreaterThan(9);
    expect((await instanceForHost("river-preview.vercel.app", river))?.id).toBe(SEED_INSTANCE_ID);
    expect(await instanceForHost("unknown.example", river)).toBeUndefined();
  });

  it("every host on a Vercel preview gets the seed instance", async () => {
    delete process.env.INSTANCE_HOST_ALIASES;
    process.env.VERCEL_ENV = "preview";
    expect((await instanceForHost("river-git-branch-mosaic.vercel.app", river))?.id).toBe(SEED_INSTANCE_ID);
  });
});
