import { afterEach, describe, expect, it } from "vitest";
import { checkEnv, env } from "../../src/config/env.js";

const NAMES = [
  "APP", "PORT", "VERCEL", "VERCEL_ENV", "FETCH_FIXTURES_DIR", "TEST_ROUTES", "TEST_CLOCK_NOW", "TEST_DID_LOOPBACK", "TEST_STAND_IN_FEDIVERSE", "EMAIL_TRANSPORT",
  "TRUSTED_DID_HOSTS", "INSTANCE_HOST_ALIASES", "NODE_ENV",
];
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

  it("reads TEST_CLOCK_NOW as a date and refuses one that isn't", () => {
    set({ TEST_CLOCK_NOW: "2026-10-21T00:00:00.000Z" });
    expect(env.testClockNow?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    set({ TEST_CLOCK_NOW: "yesterday" });
    expect(() => checkEnv()).toThrow(/TEST_CLOCK_NOW must be/);
    set({});
    expect(env.testClockNow).toBeUndefined();
  });

  it("lowercases instance host aliases and reads VERCEL_ENV", () => {
    set({ INSTANCE_HOST_ALIASES: "LocalHost, river-preview.vercel.app", VERCEL_ENV: "preview" });
    expect(env.instanceHostAliases).toEqual(["localhost", "river-preview.vercel.app"]);
    expect(env.vercelEnv).toBe("preview");
  });

  const TEST_VALUES: Record<string, string> = {
    FETCH_FIXTURES_DIR: "tests/fixtures/http",
    TEST_ROUTES: "1",
    TEST_CLOCK_NOW: "2026-10-21T00:00:00.000Z",
    TEST_DID_LOOPBACK: "1",
    TEST_STAND_IN_FEDIVERSE: "1",
  };
  it.each(Object.keys(TEST_VALUES))("refuses %s when VERCEL is set", (name) => {
    set({ VERCEL: "1", [name]: TEST_VALUES[name] });
    expect(() => checkEnv()).toThrow(new RegExp(`${name} is for local runs and CI only`));
  });

  // Security review of 3a86e8f, item 8: a production build anywhere, not only on Vercel.
  it.each(Object.keys(TEST_VALUES))("refuses %s when NODE_ENV is production", (name) => {
    set({ NODE_ENV: "production", [name]: TEST_VALUES[name] });
    expect(() => checkEnv()).toThrow(new RegExp(`${name} is for local runs and CI only; it must not be set with NODE_ENV=production`));
  });

  it("refuses EMAIL_TRANSPORT=capture in production, and allows it on previews and locally", () => {
    set({ EMAIL_TRANSPORT: "capture", VERCEL_ENV: "production" });
    expect(() => checkEnv()).toThrow(/EMAIL_TRANSPORT=capture is for tests/);
    set({ EMAIL_TRANSPORT: "capture", VERCEL_ENV: "preview" });
    expect(env.emailTransport).toBe("capture");
    set({ EMAIL_TRANSPORT: "capture" });
    expect(() => checkEnv()).not.toThrow();
    set({ EMAIL_TRANSPORT: "resend", VERCEL_ENV: "production" });
    expect(env.emailTransport).toBe("resend");
  });

  it("starts on Vercel without the test-only variables", () => {
    set({ VERCEL: "1" });
    expect(env.fetchFixturesDir).toBeUndefined();
    expect(env.testRoutes).toBe(false);
    expect(env.testClockNow).toBeUndefined();
    expect(env.testDidLoopback).toBe(false);
    expect(env.testStandInFediverse).toBe(false);
    expect(() => checkEnv()).not.toThrow();
  });
});
