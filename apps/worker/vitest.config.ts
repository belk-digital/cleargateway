import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { globalSetup: ["./vitest.global-setup.ts"], fileParallelism: false, testTimeout: 60_000, hookTimeout: 60_000 },
});
