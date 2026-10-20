import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";
import { toVercelHandler } from "../../src/shared/http/vercel.js";

function urlSeenBy(options: { stripPrefix?: string }, url: string): string | undefined {
  let seen: string | undefined;
  const app = ((req: IncomingMessage) => {
    seen = req.url;
  }) as unknown as Express;
  toVercelHandler(app, options)({ url } as IncomingMessage, {} as ServerResponse);
  return seen;
}

describe("toVercelHandler", () => {
  it("strips /api for the River", () => {
    expect(urlSeenBy({ stripPrefix: "/api" }, "/api/health")).toBe("/health");
    expect(urlSeenBy({ stripPrefix: "/api" }, "/api")).toBe("/");
    expect(urlSeenBy({ stripPrefix: "/api" }, "/api?x=1")).toBe("/?x=1");
    expect(urlSeenBy({ stripPrefix: "/api" }, "/apiary")).toBe("/apiary");
  });

  it("leaves the identity host's paths alone", () => {
    expect(urlSeenBy({}, "/health")).toBe("/health");
    expect(urlSeenBy({}, "/api/health")).toBe("/api/health");
  });
});
