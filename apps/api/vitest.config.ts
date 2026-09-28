import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { globalSetup: ["./vitest.global-setup.ts"], fileParallelism: false, testTimeout: 20_000 },
});
