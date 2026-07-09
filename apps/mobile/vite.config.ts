import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
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
