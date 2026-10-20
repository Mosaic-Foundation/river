import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../../src/app.js";
import type { AppName } from "../../src/shared/appName.js";

// Both apps start and answer /health with no DATABASE_URL or other secrets (M0).
describe.each<AppName>(["river", "identity"])("createApp(%s)", (kind) => {
  let server: Server;
  let base: string;
  const saved = process.env.DATABASE_URL;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    server = createApp(kind).listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reports ok and which app answered", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, app: kind });
  });

  it("serves only its own side's routes", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    if (kind === "river") {
      expect(await res.json()).toEqual({ app: "river", name: "Mosaic River" });
    } else {
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      expect(await res.text()).toContain("<h1>Mosaic ID</h1>");
    }
  });

  it("answers unknown paths with 404", async () => {
    const res = await fetch(`${base}/no-such-path`);
    expect(res.status).toBe(404);
  });
});
