import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@slate/storage/replace-batch": fromRoot("./packages/storage/src/replaceBatch.ts"),
      "@slate/storage/tidy-batch": fromRoot("./packages/storage/src/tidyBatch.ts"),
      "@slate/storage/tauri-workspace-index": fromRoot("./packages/storage/src/tauriWorkspaceIndex.ts"),
      "@slate/storage/tauri-files": fromRoot("./packages/storage/src/tauriFiles.ts"),
      "@slate/storage/file-io": fromRoot("./packages/storage/src/fileIO.ts"),
      "@slate/storage/file-space": fromRoot("./packages/storage/src/fileSpace.ts"),
      "@slate/storage/browser-tidy": fromRoot("./packages/storage/src/browserTidy.ts"),
      "@slate/storage/browser-import": fromRoot("./packages/storage/src/browserImport.ts"),
      "@slate/storage/browser-ownership": fromRoot("./packages/storage/src/browserOwnership.ts"),
      "@slate/storage/browser-files": fromRoot("./packages/storage/src/browserFiles.ts"),
      "@slate/storage/browser-space": fromRoot("./packages/storage/src/browserSpace.ts"),
      "@slate/storage/browser-archive": fromRoot("./packages/storage/src/browserArchive.ts"),
      "@slate/storage/browser-catalog": fromRoot("./packages/storage/src/browserCatalog.ts"),
      "@slate/core/tidy/settings": fromRoot("./packages/core/src/tidy/settings.ts"),
      "@slate/core/tidy": fromRoot("./packages/core/src/tidy/index.ts"),
      "@slate/core": fromRoot("./packages/core/src/index.ts"),
      "@slate/export": fromRoot("./packages/export/src/index.ts"),
      "@slate/publish": fromRoot("./packages/publish/src/index.ts"),
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
      reporter: ["text", "html"],
      include: ["packages/core/src/**/*.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 75
      }
    }
  }
});
