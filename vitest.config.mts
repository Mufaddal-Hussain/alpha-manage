import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Integration tests talk to a remote Neon branch: concurrent transactions queue on a row lock over the network.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Makes .env.local variables (TEST_DATABASE_URL for tests/integration) visible to tests.
    // Next's own loader skips .env.local when NODE_ENV=test, so Vite's loader is used here.
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
