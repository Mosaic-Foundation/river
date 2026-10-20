// Server lint rules. They enforce the same boundaries the Civic Hub uses:
//   1. Environment variables are read only through src/config/env.ts.
//   2. The raw Supabase client is imported only under src/db/ (and scripts/, tests/).
// The UI has its own config in ui/eslint.config.js. docs/ holds reference copies of code from
// other repos (read, never imported), so it is not linted.
import tsParser from "@typescript-eslint/parser";

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
    files: ["src/**/*.ts", "api/**/*.ts"],
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
  {
    files: ["src/**/*.ts", "api/**/*.ts"],
    ignores: ["src/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/supabase-js",
              message: "Use the database helpers in src/db/ instead of the raw client.",
            },
          ],
        },
      ],
    },
  },
];
