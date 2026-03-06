import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    // URLPattern polyfill for jsdom environment
    setupFiles: ["tests/setup.ts"],
  },
});
