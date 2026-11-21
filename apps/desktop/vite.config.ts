import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { markdownWorker } from "../../scripts/markdown-worker";

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  worker: { format: "es", plugins: () => [markdownWorker()] },
  build: { rollupOptions: { input: { app: fromRoot("./index.html"), capture: fromRoot("./capture.html"), diagram: fromRoot("./diagram-preview.html") } } },
  clearScreen: false,
  server: {
    strictPort: true,
    host: "127.0.0.1",
    port: 1420
  },
  resolve: {
    alias: {
      "@slate/storage/replace-batch": fromRoot("../../packages/storage/src/replaceBatch.ts"),
      "@slate/storage/tidy-batch": fromRoot("../../packages/storage/src/tidyBatch.ts"),
      "@slate/ui/native-capture": fromRoot("../../packages/ui/src/native/CaptureApp.tsx"),
      "@slate/ui/native": fromRoot("../../packages/ui/src/native/NativeApp.tsx"),
      "@slate/storage/tauri-workspace-index": fromRoot("../../packages/storage/src/tauriWorkspaceIndex.ts"),
      "@slate/storage/tauri-files": fromRoot("../../packages/storage/src/tauriFiles.ts"),
      "@slate/storage/file-io": fromRoot("../../packages/storage/src/fileIO.ts"),
      "@slate/storage/file-space": fromRoot("../../packages/storage/src/fileSpace.ts"),
      "@slate/storage/browser-import": fromRoot("../../packages/storage/src/browserImport.ts"),
      "@slate/storage/browser-space": fromRoot("../../packages/storage/src/browserSpace.ts"),
      "@slate/storage/browser-archive": fromRoot("../../packages/storage/src/browserArchive.ts"),
      "@slate/storage/browser-catalog": fromRoot("../../packages/storage/src/browserCatalog.ts"),
      "@slate/storage/browser-ownership": fromRoot("../../packages/storage/src/browserOwnership.ts"),
      "@slate/storage/tauri-sql": fromRoot("../../packages/storage/src/tauriSql.ts"),
      "@slate/storage/web-opfs": fromRoot("../../packages/storage/src/webOpfsSqlite.ts"),
      "@slate/storage/runtime": fromRoot("../../packages/storage/src/runtimeSqliteAdapter.ts"),
      "@slate/storage/web-file-source": fromRoot("../../packages/storage/src/webFileSource.ts"),
      "@slate/storage/tauri-file-source": fromRoot("../../packages/storage/src/tauriFileSource.ts"),
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
