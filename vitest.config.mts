import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": r("./src"),
      // `server-only` throws outside React Server Components; tests run the same code in plain Node.
      "server-only": r("./tests/helpers/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    pool: "forks", // one process (and one temporary database) per test file
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
