// The identity host's error log line (src/identity/routes.ts): configuration errors say what is
// wrong; database errors keep their detail out of the log. No database.
import { describe, expect, it } from "vitest";
import { errorLogLine } from "../../src/identity/routes.js";

describe("identity error log line", () => {
  it("logs a configuration error's message (no code): it names the setting", () => {
    const err = new Error("IDENTITY_RECOVERY_PUBLIC_KEY must be a multikey (z6Mk...)");
    expect(errorLogLine("GET", "/authorize", err)).toBe(
      "identity: GET /authorize failed: Error: IDENTITY_RECOVERY_PUBLIC_KEY must be a multikey (z6Mk...)",
    );
    const typed = Object.assign(new TypeError("RIVER_CLIENT_ORIGINS is empty\n  (set it in Vercel)"), {});
    expect(errorLogLine("GET", "/authorize", typed)).toBe(
      "identity: GET /authorize failed: TypeError: RIVER_CLIENT_ORIGINS is empty (set it in Vercel)",
    );
  });

  it("keeps a database error's message and detail out: name and SQLSTATE only", () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "people_email_key"'), {
      name: "error",
      code: "23505",
      detail: "Key (email)=(someone@example.org) already exists.",
    });
    const line = errorLogLine("POST", "/authorize/signup", err);
    expect(line).toBe("identity: POST /authorize/signup failed: error (23505)");
    expect(line).not.toMatch(/example\.org|duplicate|people_email_key/);
  });

  it("treats any coded error (a driver or system error) like a database error", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:6543"), { code: "ECONNREFUSED" });
    expect(errorLogLine("GET", "/authorize", err)).toBe("identity: GET /authorize failed: Error (ECONNREFUSED)");
  });

  it("caps a long message and survives things that aren't errors", () => {
    const line = errorLogLine("GET", "/authorize", new Error("x".repeat(1000)));
    expect(line.length).toBeLessThan(400);
    expect(line.endsWith("…")).toBe(true);
    expect(errorLogLine("GET", "/authorize", "boom")).toBe("identity: GET /authorize failed: Error");
    expect(errorLogLine("GET", "/authorize", null)).toBe("identity: GET /authorize failed: Error");
    expect(errorLogLine("GET", "/authorize", new Error(""))).toBe("identity: GET /authorize failed: Error");
  });
});
