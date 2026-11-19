import { createRequire } from "node:module";
import { normalizePath, type Plugin } from "vite";

/** The package's browser entry uses document; workers need its pure entity table. */
export function markdownWorker(): Plugin {
  return {
    name: "slate-markdown-worker",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "decode-named-character-reference" || !importer) return;
      return normalizePath(createRequire(importer).resolve(source));
    },
  };
}
