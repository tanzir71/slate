import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { markdownWorker } from "../../scripts/markdown-worker";

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  worker: { format: "es", plugins: () => [markdownWorker()] },
  resolve: {
    alias: {
      "@slate/storage/browser-tidy": fromRoot("../../packages/storage/src/browserTidy.ts"),
      "@slate/storage/browser-files": fromRoot("../../packages/storage/src/browserFiles.ts"),
      "@slate/core/tidy/settings": fromRoot("../../packages/core/src/tidy/settings.ts"),
      "@slate/core/tidy": fromRoot("../../packages/core/src/tidy/index.ts"),
      "@slate/core": fromRoot("../../packages/core/src/index.ts"),
      "@slate/editor": fromRoot("../../packages/editor/src/index.ts"),
      "@slate/export": fromRoot("../../packages/export/src/index.ts"),
      "@slate/publish": fromRoot("../../packages/publish/src/index.ts"),
      "@slate/storage": fromRoot("../../packages/storage/src/index.ts"),
      "@slate/sync": fromRoot("../../packages/sync/src/index.ts"),
      "@slate/tokens": fromRoot("../../packages/tokens/src/index.ts"),
      "@slate/ui": fromRoot("../../packages/ui/src/index.ts")
    }
  }
});
