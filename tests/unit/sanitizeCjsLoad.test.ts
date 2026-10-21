// Vercel's function loader require()s sanitize-html and can't load ES-only dependencies, while
// plain Node 24 can. sanitize-html 2.18 pulls in htmlparser2 12 (ES-only), which crashed every
// function at load; package.json overrides it to htmlparser2 10 (CommonJS). This loads
// sanitize-html with require(esm) turned off, which reproduces the Vercel failure.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("sanitize-html under a CommonJS-only loader", () => {
  it("loads and sanitizes with --no-experimental-require-module", () => {
    const script =
      'const s = require("sanitize-html");' +
      'process.stdout.write(s("<p>ok<script>x</script></p>"));';
    const result = spawnSync(process.execPath, ["--no-experimental-require-module", "-e", script], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.stderr).not.toMatch(/ERR_REQUIRE_ESM/);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("<p>ok</p>");
  });
});
