import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M6: the River's Content-Security-Policy (spec Appendix B) is served by Vercel from vercel.json,
// and `vite preview` reads the same header from it (ui/vite.config.ts). The e2e suite checks it
// on the page itself.
function csp(): Map<string, string> {
  const vercel = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const rule = vercel.headers.find((r) => r.source === "/(.*)");
  const value = rule?.headers.find((h) => h.key === "Content-Security-Policy")?.value;
  expect(value, "vercel.json sets Content-Security-Policy on every path").toBeTruthy();
  return new Map(
    value!
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .map(([name, ...sources]) => [name, sources.join(" ")]),
  );
}

describe("River CSP", () => {
  it("allows no inline scripts, images from self and https, connections to self only", () => {
    const policy = csp();
    expect(policy.get("script-src")).toBe("'self'");
    expect(policy.get("img-src")).toBe("'self' https:");
    expect(policy.get("connect-src")).toBe("'self'");
    expect(policy.get("default-src")).toBe("'self'");
    expect(policy.get("object-src")).toBe("'none'");
    for (const sources of policy.values()) {
      expect(sources).not.toMatch(/unsafe-inline|unsafe-eval|data:|\*/);
    }
  });
});

describe("sign-in headers on Vercel (M8)", () => {
  it("/api/auth/* is sent with Referrer-Policy: no-referrer, after the every-path rule so it wins", () => {
    const vercel = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const all = vercel.headers.findIndex((r) => r.source === "/(.*)");
    const auth = vercel.headers.findIndex((r) => r.source === "/api/auth/(.*)");
    expect(auth).toBeGreaterThan(all);
    expect(vercel.headers[auth].headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
  });
});
