import { afterEach, describe, expect, it } from "vitest";
import { checkEnv, env } from "../../src/config/env.js";

const NAMES = ["APP", "PORT", "VERCEL", "FETCH_FIXTURES_DIR", "TEST_ROUTES", "EMAIL_TRANSPORT", "TRUSTED_DID_HOSTS"];
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

function set(values: Record<string, string | undefined>): void {
  for (const name of NAMES) delete process.env[name];
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) process.env[name] = value;
  }
}

describe("env", () => {
  it("defaults to the River on :3000 and the identity host on :3001", () => {
    set({});
    expect(env.app).toBe("river");
    expect(env.port).toBe(3000);
    set({ APP: "identity" });
    expect(env.app).toBe("identity");
    expect(env.port).toBe(3001);
    set({ APP: "identity", PORT: "4100" });
    expect(env.port).toBe(4100);
  });

  it("rejects an unknown APP", () => {
    set({ APP: "admin" });
    expect(() => env.app).toThrow(/APP must be/);
    expect(() => checkEnv()).toThrow(/APP must be/);
  });

  it("requires DATABASE_URL only when read", () => {
    set({});
    expect(() => checkEnv()).not.toThrow();
    expect(() => env.databaseUrl).toThrow(/DATABASE_URL/);
  });

  it("parses comma lists", () => {
    set({ TRUSTED_DID_HOSTS: " id.mosaic.social, ,localhost " });
    expect(env.trustedDidHosts).toEqual(["id.mosaic.social", "localhost"]);
  });

  it("checks EMAIL_TRANSPORT and defaults to log", () => {
    set({});
    expect(env.emailTransport).toBe("log");
    set({ EMAIL_TRANSPORT: "smtp" });
    expect(() => checkEnv()).toThrow(/EMAIL_TRANSPORT/);
  });

  it("allows the test-only variables locally", () => {
    set({ FETCH_FIXTURES_DIR: "tests/fixtures/http", TEST_ROUTES: "1" });
    expect(env.fetchFixturesDir).toBe("tests/fixtures/http");
    expect(env.testRoutes).toBe(true);
    expect(() => checkEnv()).not.toThrow();
  });

  it.each(["FETCH_FIXTURES_DIR", "TEST_ROUTES"])("refuses %s when VERCEL is set", (name) => {
    set({ VERCEL: "1", [name]: name === "TEST_ROUTES" ? "1" : "tests/fixtures/http" });
    expect(() => checkEnv()).toThrow(new RegExp(`${name} is for local runs and CI only`));
  });

  it("starts on Vercel without the test-only variables", () => {
    set({ VERCEL: "1" });
    expect(env.fetchFixturesDir).toBeUndefined();
    expect(env.testRoutes).toBe(false);
    expect(() => checkEnv()).not.toThrow();
  });
});
