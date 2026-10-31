import { defineConfig } from "vitest/config";

// Every run in UTC (CLAUDE.md §5): a local-time leak shows up as a failing
// test instead of passing on a developer's machine in Europe/Madrid. Set here,
// in the main process, so every worker inherits it.
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
  },
});
