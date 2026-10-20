import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

// The lint rules behind CLAUDE.md constraints 1 and 2, checked against the repo's own config.
const eslint = new ESLint();

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId ?? m.message);
}

describe("lint boundaries", () => {
  it.each(["src/river/x.ts", "src/identity/x.ts", "src/shared/x.ts", "api/x.ts", "identity/api/x.ts"])(
    "forbids importing pg in %s",
    async (file) => {
      expect(await ruleIds(file, 'import pg from "pg";\nexport default pg;\n')).toContain("no-restricted-imports");
      expect(await ruleIds(file, 'import { Pool } from "pg-pool";\nexport default Pool;\n')).toContain(
        "no-restricted-imports",
      );
    },
  );

  it("allows pg under src/db/", async () => {
    expect(await ruleIds("src/db/x.ts", 'import pg from "pg";\nexport default pg;\n')).toEqual([]);
  });

  it.each(["src/river/x.ts", "src/db/x.ts", "identity/api/x.ts"])("forbids process.env in %s", async (file) => {
    expect(await ruleIds(file, "export const a = process.env.X;\n")).toContain("no-restricted-properties");
  });

  it("allows process.env in src/config/env.ts", async () => {
    expect(await ruleIds("src/config/env.ts", "export const a = process.env.X;\n")).toEqual([]);
  });
});
