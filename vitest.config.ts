import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Coverage of what is published to npm; apps/ are the demo and its tooling.
    coverage: { include: ["packages/*/src/**"], reporter: ["text-summary", "text"] },
  },
});
