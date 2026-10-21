// `@live` tests (spec 6, check 32) run only through `npm run test:live`: never in `npm run check`,
// `test:api`, `test:e2e` or CI. This proves the wiring without touching the network.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import playwrightConfig from "../../playwright.config.js";
import liveConfig from "../../vitest.live.config.js";
import defaultConfig from "../../vitest.config.js";

const root = path.resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
const liveFiles = readdirSync(path.join(root, "tests/live")).filter((f) => f.endsWith(".ts"));

describe("@live tests stay out of the default runs", () => {
  it("the default Vitest config includes only tests/unit and tests/api", () => {
    const include = defaultConfig.test?.include ?? [];
    expect(include.length).toBeGreaterThan(0);
    for (const glob of include) expect(glob).toMatch(/^tests\/(unit|api)\//);
  });

  it("Playwright reads only tests/e2e", () => {
    expect(path.resolve(root, playwrightConfig.testDir ?? "")).toBe(path.join(root, "tests/e2e"));
  });

  it("the live config reads only tests/live, and only tests named @live", () => {
    expect(liveConfig.test?.include).toEqual(["tests/live/**/*.live.test.ts"]);
    expect(liveConfig.test?.testNamePattern).toBe("@live");
  });

  it("only test:live uses the live config; check, test:api and test:e2e don't", () => {
    expect(pkg.scripts["test:live"]).toContain("vitest.live.config.ts");
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (name !== "test:live") expect(script, name).not.toMatch(/live/);
    }
  });

  it("CI never runs test:live", () => {
    for (const file of readdirSync(path.join(root, ".github/workflows"))) {
      expect(readFileSync(path.join(root, ".github/workflows", file), "utf8"), file).not.toMatch(/test:live|vitest\.live|tests\/live/);
    }
  });

  it("every live file is *.live.test.ts and every test in it is named @live", () => {
    expect(liveFiles.length).toBeGreaterThan(0);
    for (const file of liveFiles) {
      expect(file).toMatch(/\.live\.test\.ts$/);
      const source = readFileSync(path.join(root, "tests/live", file), "utf8");
      const names = [...source.matchAll(/\bit\(\s*[`"']([^`"']*)/g)].map((m) => m[1] ?? "");
      expect(names.length, file).toBeGreaterThan(0);
      for (const name of names) expect(name, `${file}: ${name}`).toContain("@live");
    }
  });
});
