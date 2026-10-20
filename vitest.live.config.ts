import { defineConfig } from "vitest/config";

// `@live` tests (spec 6, check 32): real hubs and fediverse accounts, over the network. Run only
// through `npm run test:live`, on Adam's machine or in an on-demand thread, never in `check` or
// `ci` (vitest.config.ts doesn't include tests/live/). Name files `*.live.test.ts` and put
// `@live` in each test's name.
export default defineConfig({
  test: {
    include: ["tests/live/**/*.live.test.ts"],
    testNamePattern: "@live",
    passWithNoTests: true,
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
