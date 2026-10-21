// Server lint rules. They enforce the same boundaries the Civic Hub uses:
//   1. Environment variables are read only through src/config/env.ts.
//   2. `pg` is imported only under src/db/; everything else uses forInstance(), forAccount() or
//      forIdentity() from src/db/context.ts (CLAUDE.md constraint 2, ADR-004).
//   3. undici, node:http(s) and global fetch only under src/shared/fetch/ (constraint 3, ADR-001).
//      The identity host's browser script (src/identity/client/) runs in the browser and may fetch.
//   4. River code never imports src/identity/ and identity code never imports src/river/
//      (constraint 7, ADR-002): they meet only through the sign-in redirect and the signed note.
// The UI has its own config in ui/eslint.config.js. docs/ holds reference copies of code from
// other repos (read, never imported), so it is not linted.
import tsParser from "@typescript-eslint/parser";

const PG_MESSAGE = "Query through forInstance(), forAccount() or forIdentity() in src/db/context.ts.";
const PG = {
  paths: [{ name: "pg", message: PG_MESSAGE }],
  patterns: [{ group: ["pg/*", "pg-*"], message: PG_MESSAGE }],
};

const NET_MESSAGE = "Outbound requests go through the fetch guard in src/shared/fetch/ (ADR-001).";
const NET = {
  paths: ["undici", "node:http", "node:https", "http", "https", "node:http2", "http2"].map((name) => ({
    name,
    message: NET_MESSAGE,
  })),
  patterns: [{ group: ["undici/*"], message: NET_MESSAGE }],
};

const SIDES_MESSAGE =
  "The River and the identity host meet only through the sign-in redirect and the signed note (constraint 7, ADR-002).";
const NOT_IDENTITY = { group: ["**/identity/**", "**/identity/*.js", "**/identity/index.js"], message: SIDES_MESSAGE };
const NOT_RIVER = { group: ["**/river/**", "**/river/*.js", "**/river/index.js"], message: SIDES_MESSAGE };

export default [
  {
    ignores: [
      "dist/**",
      "ui/**",
      "docs/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module" },
  },
  {
    files: ["src/**/*.ts", "api/**/*.ts", "identity/**/*.ts"],
    ignores: ["src/config/env.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read the environment through src/config/env.ts.",
        },
      ],
    },
  },
  // no-restricted-imports: one block per area, with disjoint files, because a later block that
  // matches the same file replaces the rule's whole option list instead of adding to it.
  {
    files: ["src/**/*.ts", "api/**/*.ts", "identity/**/*.ts"],
    ignores: ["src/db/**", "src/shared/fetch/**", "src/shared/http/**", "src/river/**", "src/identity/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [...PG.paths, ...NET.paths], patterns: [...PG.patterns, ...NET.patterns] },
      ],
    },
  },
  {
    files: ["src/river/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [...PG.paths, ...NET.paths], patterns: [...PG.patterns, ...NET.patterns, NOT_IDENTITY] },
      ],
    },
  },
  {
    files: ["src/identity/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [...PG.paths, ...NET.paths], patterns: [...PG.patterns, ...NET.patterns, NOT_RIVER] },
      ],
    },
  },
  {
    files: ["src/db/**/*.ts"],
    rules: { "no-restricted-imports": ["error", NET] },
  },
  // src/shared/http/ adapts the inbound request (node:http types only); it makes no requests.
  {
    files: ["src/shared/fetch/**/*.ts", "src/shared/http/**/*.ts"],
    rules: { "no-restricted-imports": ["error", PG] },
  },
  // 3. No global fetch on the server: outbound requests go through the fetch guard (ADR-001).
  {
    files: ["src/**/*.ts", "api/**/*.ts", "identity/**/*.ts"],
    ignores: ["src/identity/client/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Use the fetch guard in src/shared/fetch/ (ADR-001)." },
      ],
    },
  },
];
