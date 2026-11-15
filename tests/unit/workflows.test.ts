// The GitHub workflows' credential hygiene (security review of 3a86e8f, item 8), read as text:
// every checkout keeps no token, deploy-migrations sets its Supabase secrets only on the steps that
// run the CLI, and no workflow expands a variable or secret into a script's text.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(".github/workflows");
const workflows = readdirSync(DIR)
  .filter((f) => f.endsWith(".yml"))
  .map((f) => ({ name: f, text: readFileSync(path.join(DIR, f), "utf8") }));

describe("workflows", () => {
  it("found the workflows", () => {
    expect(workflows.map((w) => w.name).sort()).toEqual(expect.arrayContaining(["ci.yml", "deploy-migrations.yml"]));
  });

  it.each(workflows.map((w) => [w.name, w.text]))("%s: every checkout has persist-credentials: false", (name, text) => {
    const checkouts = [...text.matchAll(/uses: actions\/checkout@[^\n]*\n((?:\s{8,}[^\n]*\n)*)/g)];
    // keep-alive only makes two requests, so it checks nothing out (asserted below).
    if (name !== "keep-alive.yml") expect(checkouts.length).toBeGreaterThan(0);
    for (const [, block] of checkouts) expect(block).toMatch(/persist-credentials: false/);
  });

  it.each(workflows.map((w) => [w.name, w.text]))("%s: no ${{ }} expression inside a run script", (_name, text) => {
    const runs = [...text.matchAll(/^(\s*)run: (\|\n(?:\1\s+[^\n]*\n)*|[^\n]*)/gm)].map((m) => m[2]);
    for (const run of runs) expect(run).not.toMatch(/\$\{\{/);
  });

  it("deploy-migrations: no Supabase secret at job level", () => {
    const text = workflows.find((w) => w.name === "deploy-migrations.yml")!.text;
    const job = text.slice(text.indexOf("jobs:"), text.indexOf("    steps:"));
    expect(job).not.toMatch(/secrets\./);
    // Each secret appears only in a step's env.
    for (const line of text.split("\n").filter((l) => l.includes("secrets."))) {
      if (line.trimStart().startsWith("#")) continue;
      expect(line).toMatch(/^ {10}SUPABASE_[A-Z_]+: \$\{\{ secrets\.SUPABASE_[A-Z_]+ \}\}$/);
    }
  });

  it("keep-alive: no checkout, no token, no secrets", () => {
    const text = workflows.find((w) => w.name === "keep-alive.yml")!.text;
    expect(text).not.toMatch(/uses: /);
    expect(text).toMatch(/^permissions: \{\}$/m);
    expect(text).not.toMatch(/secrets\./);
  });
});
