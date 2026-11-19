import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { VitePWA } from "vite-plugin-pwa";
import { markdownWorker } from "../../scripts/markdown-worker";

const fromRoot = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));
const appVersion = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

export default defineConfig({
  base: "./",
  define: { __SLATE_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), VitePWA({
    registerType: "prompt",
    injectRegister: false,
    manifest: false,
    workbox: {
      globPatterns: ["**/*.{js,css,html,svg,png,woff2,wasm,json,webmanifest}"],
      maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      navigateFallback: "index.html",
      cleanupOutdatedCaches: true,
      clientsClaim: true
    }
  })],
  worker: { format: "es", plugins: () => [markdownWorker()] },
  resolve: {
    alias: {
      "@slate/storage/tidy-batch": fromRoot("../../packages/storage/src/tidyBatch.ts"),
      "@slate/storage/tauri-workspace-index": fromRoot("../../packages/storage/src/tauriWorkspaceIndex.ts"),
      "@slate/storage/tauri-files": fromRoot("../../packages/storage/src/tauriFiles.ts"),
      "@slate/storage/file-io": fromRoot("../../packages/storage/src/fileIO.ts"),
      "@slate/storage/file-space": fromRoot("../../packages/storage/src/fileSpace.ts"),
      "@slate/storage/tauri-sql": fromRoot("../../packages/storage/src/tauriSql.ts"),
      "@slate/storage/web-file-source": fromRoot("../../packages/storage/src/webFileSource.ts"),
      "@slate/storage/tauri-file-source": fromRoot("../../packages/storage/src/tauriFileSource.ts"),
      "@slate/ui/browser": fromRoot("../../packages/ui/src/browser/BrowserApp.tsx"),
      "@slate/storage/browser-tidy": fromRoot("../../packages/storage/src/browserTidy.ts"),
      "@slate/storage/browser-files": fromRoot("../../packages/storage/src/browserFiles.ts"),
      "@slate/storage/browser-import": fromRoot("../../packages/storage/src/browserImport.ts"),
      "@slate/storage/browser-space": fromRoot("../../packages/storage/src/browserSpace.ts"),
      "@slate/storage/browser-archive": fromRoot("../../packages/storage/src/browserArchive.ts"),
      "@slate/storage/browser-catalog": fromRoot("../../packages/storage/src/browserCatalog.ts"),
      "@slate/storage/browser-ownership": fromRoot("../../packages/storage/src/browserOwnership.ts"),
      "@slate/storage/web-opfs": fromRoot("../../packages/storage/src/webOpfsSqlite.ts"),
      "@slate/storage/runtime": fromRoot("../../packages/storage/src/runtimeSqliteAdapter.ts"),
      "@slate/core/tidy/settings": fromRoot("../../packages/core/src/tidy/settings.ts"),
      "@slate/core/tidy": fromRoot("../../packages/core/src/tidy/index.ts"),
      "@slate/core": fromRoot("../../packages/core/src/index.ts"),
      "@slate/editor": fromRoot("../../packages/editor/src/index.ts"),
      "@slate/export": fromRoot("../../packages/export/src/index.ts"),
      "@slate/publish": fromRoot("../../packages/publish/src/index.ts"),
      "@slate/storage": fromRoot("../../packages/storage/src/index.ts"),
      "@slate/sync": fromRoot("../../packages/sync/src/index.ts"),
      "@slate/tokens": fromRoot("../../packages/tokens/src/index.ts"),
      "@slate/ui": fromRoot("../../packages/ui/src/index.ts"),
    },
  },
});
