import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@slate/core": fromRoot("./packages/core/src/index.ts"),
      "@slate/storage": fromRoot("./packages/storage/src/index.ts"),
      "@slate/sync": fromRoot("./packages/sync/src/index.ts"),
      "@slate/editor": fromRoot("./packages/editor/src/index.ts"),
      "@slate/ui": fromRoot("./packages/ui/src/index.ts"),
      "@slate/tokens": fromRoot("./packages/tokens/src/index.ts")
    }
  },
  test: {
    environment: "jsdom",
    include: ["packages/*/test/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"]
    }
  }
});
