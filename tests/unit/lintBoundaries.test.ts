import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

// The lint rules behind CLAUDE.md constraints 1, 2 and 3, checked against the repo's own config.
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

  it.each(["src/river/x.ts", "src/identity/x.ts", "src/shared/x.ts", "src/db/x.ts", "api/x.ts", "identity/api/x.ts"])(
    "forbids network modules and global fetch in %s",
    async (file) => {
      for (const mod of ["undici", "node:http", "node:https", "https", "undici/types/dispatcher"]) {
        expect(await ruleIds(file, `import x from "${mod}";\nexport default x;\n`), mod).toContain("no-restricted-imports");
      }
      expect(await ruleIds(file, 'export const r = fetch("https://example.org");\n')).toContain("no-restricted-globals");
    },
  );

  it("still forbids pg next to the network rules", async () => {
    expect(await ruleIds("src/river/x.ts", 'import pg from "pg";\nexport default pg;\n')).toContain("no-restricted-imports");
    expect(await ruleIds("src/shared/fetch/x.ts", 'import pg from "pg";\nexport default pg;\n')).toContain("no-restricted-imports");
  });

  it("allows undici and node:https only in the fetch guard", async () => {
    expect(await ruleIds("src/shared/fetch/x.ts", 'import { Agent } from "undici";\nexport default Agent;\n')).toEqual([]);
  });

  it("keeps the River and the identity host apart (constraint 7)", async () => {
    for (const mod of ["../identity/note.js", "../../identity/did/index.js", "../identity/index.js"]) {
      expect(await ruleIds("src/river/auth/x.ts", `import x from "${mod}";\nexport default x;\n`), mod).toContain(
        "no-restricted-imports",
      );
    }
    for (const mod of ["../river/accounts.js", "../../river/feed/index.js"]) {
      expect(await ruleIds("src/identity/flows/x.ts", `import x from "${mod}";\nexport default x;\n`), mod).toContain(
        "no-restricted-imports",
      );
    }
    // Both may use shared code, and the River still may not import pg or undici.
    expect(await ruleIds("src/river/auth/x.ts", 'import x from "../../shared/fetch/index.js";\nexport default x;\n')).toEqual([]);
    expect(await ruleIds("src/identity/x.ts", 'import x from "../shared/fetch/index.js";\nexport default x;\n')).toEqual([]);
    expect(await ruleIds("src/river/x.ts", 'import pg from "pg";\nexport default pg;\n')).toContain("no-restricted-imports");
    expect(await ruleIds("src/identity/x.ts", 'import { Agent } from "undici";\nexport default Agent;\n')).toContain(
      "no-restricted-imports",
    );
  });

  it("lets the identity host's browser script call fetch", async () => {
    expect(await ruleIds("src/identity/client/x.ts", 'export const r = fetch("/api");\n')).toEqual([]);
  });

  it("lets a River plugin import only its ViewApi (spec 4.7)", async () => {
    const file = "src/river/plugins/builtin/x.ts";
    expect(await ruleIds(file, 'import type { ViewApi } from "../api.js";\nexport type A = ViewApi;\n')).toEqual([]);
    for (const mod of ["../../feed/query.js", "../../../db/context.js", "../registry.js", "pg", "undici", "node:fs", "../../../config/env.js"]) {
      expect(await ruleIds(file, `import x from "${mod}";\nexport default x;\n`), mod).toContain("no-restricted-imports");
    }
    for (const global of ["fetch", "process", "globalThis", "require"]) {
      expect(await ruleIds(file, `export const r = ${global};\n`), global).toContain("no-restricted-globals");
    }
  });
});
