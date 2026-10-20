import { defineConfig } from "vitest/config";

// Same shape as the Civic Hub: unit tests need no database; API tests run against a local
// Supabase stack and a running dev server, called over HTTP.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/api/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 15_000,
  },
});
