import type { Plugin } from "vite";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface BuildFile {
  type: "asset" | "chunk";
  fileName: string;
  isEntry?: boolean;
  name?: string | undefined;
  modules?: Readonly<Record<string, unknown>>;
  imports?: readonly string[];
  viteMetadata?: {
    importedCss: ReadonlySet<string>;
    importedAssets: ReadonlySet<string>;
  };
}

/** The app, editable workspace and startup readers form the offline shell. */
export function collectShellAssets(bundle: Readonly<Record<string, BuildFile>>) {
  const entry = Object.values(bundle).find(
    (file) => file.type === "chunk" && file.isEntry && file.name === "app",
  );
  if (!entry) throw new Error("The Slate app entry is required for offline precaching.");
  const files = new Set(["index.html", "diagram-preview.html", "manifest.webmanifest", "whats-new.json", "cache-migrate.js"]);
  function visit(name: string) {
    if (files.has(name)) return;
    const file = bundle[name];
    if (!file) throw new Error(`Missing shell dependency: ${name}`);
    files.add(name);
    if (file.type !== "chunk") return;
    for (const dependency of file.imports ?? []) visit(dependency);
    for (const css of file.viteMetadata?.importedCss ?? []) files.add(css);
    // Worker URLs are asset references; optional workers still load on first use.
    for (const asset of file.viteMetadata?.importedAssets ?? [])
      if (!asset.endsWith(".js")) files.add(asset);
  }
  visit(entry.fileName);
  for (const file of Object.values(bundle)) {
    if (file.type === "chunk" && file.isEntry && file.name !== "app") continue;
    const applicationModule = Object.keys(file.modules ?? {}).some(id => /[\\/]packages[\\/](?:ui|editor|core|storage)[\\/]/.test(id));
    if (file.type === "chunk" && (applicationModule || ["BrowserWorkspace", "WorkspaceDocumentEditor"].includes(file.name ?? "") || /\/workbox-window[^/]*\.js$/.test(file.fileName))) visit(file.fileName);
    if (/\/(?:browserSnapshot|index|sheetSummary|search|inspectorMentions|tidy)\.worker-[^/]+\.js$/.test(file.fileName) || /\/(?:wa-sqlite-async|sqlite-api)-[^/]+\.js$/.test(file.fileName)) files.add(file.fileName);
  }
  return files;
}

export function selectShellManifest<T extends { url: string }>(
  manifest: readonly T[],
  shell: ReadonlySet<string>,
) {
  if (!shell.size) throw new Error("Collect the built app shell before generating its worker.");
  const manifestFiles = new Set(manifest.map((entry) => entry.url.replace(/^\.\//, "")));
  for (const file of shell)
    if (!manifestFiles.has(file)) throw new Error(`Shell resource is missing from the precache: ${file}`);
  return {
    manifest: manifest.filter((entry) => {
      const path = entry.url.replace(/^\.\//, "");
      return shell.has(path) || path.startsWith("brand/") || /\.(?:woff2|wasm)$/.test(path);
    }),
    warnings: [] as string[],
  };
}

/** Keep self-contained: this function is serialized into the install-time migration. */
export async function preserveDeferredAssets(storage: Pick<CacheStorage, "keys" | "open">, scope: string, files: readonly string[], diagramFiles: readonly string[] = []) {
  const urls = new Set(files.filter(file => /^assets\/[^/\\?#]+\.(?:js|css|svg|png|json)$/.test(file))
    .map(file => new URL(file, scope).href));
  if (!urls.size) return;
  const allNames = await storage.keys(), names = allNames.filter(name => name.startsWith("workbox-precache-"));
  let target: Cache | undefined, usedDiagrams = false;
  if (allNames.includes("slate-lazy-assets-v1")) {
    target = await storage.open("slate-lazy-assets-v1");
    usedDiagrams = (await target.keys()).some(request => new URL(request.url).href.startsWith(new URL("assets/diagram-", scope).href));
  }
  for (const name of names) {
    const source = await storage.open(name);
    const requests = await source.keys(), urlsInCache = requests.map(request => { const url = new URL(request.url); url.search = ""; return url.href; });
    if (urlsInCache.includes(new URL("diagram-preview.html", scope).href) && !urlsInCache.includes(new URL("cache-migrate.js", scope).href)) usedDiagrams = true;
    for (const request of requests) {
      const url = new URL(request.url); url.search = ""; url.hash = "";
      if (!urls.has(url.href)) continue;
      target ??= await storage.open("slate-lazy-assets-v1");
      if (await target.match(url.href)) continue;
      const response = await source.match(request);
      if (response?.ok) await target.put(url.href, response);
    }
  }
  if (usedDiagrams) {
    const warm = diagramFiles.map(file => new URL(file, scope).href).filter(url => urls.has(url));
    if (!warm.length) return;
    const cache = target ??= await storage.open("slate-lazy-assets-v1");
    const found = await Promise.all(warm.map(url => cache.match(url)));
    const missing = warm.filter((_url, index) => !found[index]);
    if (missing.length) await target.addAll(missing);
  }
}

export function migrationScript(files: readonly string[], diagramFiles: readonly string[] = []) {
  return `self.addEventListener("install", event => { if (self.registration.active) event.waitUntil((${preserveDeferredAssets.toString()})(caches, self.registration.scope, ${JSON.stringify(files)}, ${JSON.stringify(diagramFiles)})); });\n`;
}

export function shellPrecache() {
  let shell: ReadonlySet<string> = new Set();
  const plugin: Plugin = {
    name: "slate-shell-precache",
    buildStart() { shell = new Set(); },
    writeBundle(options, bundle) {
      shell = collectShellAssets(bundle);
      if (!options.dir) throw new Error("An output directory is required for the cache migration.");
      const deferred = Object.keys(bundle).filter(file => !shell.has(file) && /^assets\/[^/]+\.(?:js|css|svg|png|json)$/.test(file));
      const diagramFiles = new Set<string>();
      function visitDiagram(file: string) {
        if (diagramFiles.has(file) || shell.has(file)) return;
        diagramFiles.add(file);
        const chunk = bundle[file];
        if (chunk?.type === "chunk") {
          for (const dependency of chunk.imports) visitDiagram(dependency);
          for (const css of chunk.viteMetadata?.importedCss ?? []) diagramFiles.add(css);
        }
      }
      const diagram = Object.values(bundle).find(file => file.type === "chunk" && file.isEntry && file.name === "diagram");
      if (diagram) visitDiagram(diagram.fileName);
      writeFileSync(resolve(options.dir, "cache-migrate.js"), migrationScript(deferred, [...diagramFiles]));
    },
  };
  return {
    plugin,
    transform: async <T extends { url: string }>(manifest: T[]) => selectShellManifest(manifest, shell),
  };
}
