import { defineConfig } from "vitest/config";

/**
 * Separate from vitest.config.ts on purpose: the unit suite must stay runnable in a second
 * with no build and no listening socket. This one builds and boots a real server, so it is
 * a different kind of gate and belongs behind a different command.
 */
export default defineConfig({
  test: {
    include: ["smoke/**/*.smoke.test.ts"],
    globalSetup: ["./smoke/global_setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 300_000,
  },
});
