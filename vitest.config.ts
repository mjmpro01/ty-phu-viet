import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "packages/shared/tests/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      include: ["packages/shared/src/engine/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
