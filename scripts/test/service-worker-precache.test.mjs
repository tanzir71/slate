import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectShellAssets, selectShellManifest, shellPrecache } from "../service-worker-precache.ts";

const metadata = (css = [], assets = []) => ({ importedCss: new Set(css), importedAssets: new Set(assets) });
const bundle = () => ({
  "assets/app.js": { type: "chunk", fileName: "assets/app.js", isEntry: true, name: "app", imports: ["assets/shared.js"], viteMetadata: metadata(["assets/app.css"], ["assets/logo.svg"]) },
  "assets/shared.js": { type: "chunk", fileName: "assets/shared.js", imports: ["assets/app.js"] },
  "assets/math.js": { type: "chunk", fileName: "assets/math.js", isEntry: false, imports: ["assets/shared.js"] },
  "assets/diagram.js": { type: "chunk", fileName: "assets/diagram.js", isEntry: true, name: "diagram", imports: [], modules: { "/repo/packages/editor/src/diagramProtocol.ts": {} } },
});

test("collects the app's complete static graph, styles and assets without pulling in lazy features or iframe entries", () => {
  assert.deepEqual([...collectShellAssets(bundle())].sort(), ["index.html", "diagram-preview.html", "manifest.webmanifest", "whats-new.json", "cache-migrate.js", "assets/app.js", "assets/shared.js", "assets/app.css", "assets/logo.svg"].sort());
});
test("fails a build with a missing app entry or unresolved static dependency", () => {
  assert.throws(() => collectShellAssets({}), /app entry/);
  const files = bundle(); delete files["assets/shared.js"];
  assert.throws(() => collectShellAssets(files), /Missing shell dependency/);
});
test("includes the editable workspace and editor with their transitive styles even when code-split", () => {
  const files = bundle();
  files["assets/workspace.js"] = { type: "chunk", fileName: "assets/workspace.js", name: "BrowserWorkspace", imports: ["assets/menu.js"], viteMetadata: metadata(["assets/workspace.css"]) };
  files["assets/editor.js"] = { type: "chunk", fileName: "assets/editor.js", name: "WorkspaceDocumentEditor", imports: [], viteMetadata: metadata(["assets/editor.css"]) };
  files["assets/menu.js"] = { type: "chunk", fileName: "assets/menu.js", imports: [], viteMetadata: metadata(["assets/menu.css"]) };
  const shell = collectShellAssets(files);
  for (const path of ["assets/workspace.js", "assets/editor.js", "assets/menu.js", "assets/workspace.css", "assets/editor.css", "assets/menu.css"]) assert.equal(shell.has(path), true, path);
  assert.equal(shell.has("assets/math.js"), false);
});
test("includes application workers and SQLite's WASM bootstrap while deferring the math feature worker", () => {
  const files = bundle();
  for (const fileName of ["assets/index.worker-hash.js", "assets/browserSnapshot.worker-hash.js", "assets/sheetSummary.worker-hash.js", "assets/search.worker-hash.js", "assets/inspectorMentions.worker-hash.js", "assets/tidy.worker-hash.js", "assets/wa-sqlite-async-hash.js", "assets/sqlite-api-hash.js", "assets/math.worker-hash.js"]) files[fileName] = { type: "asset", fileName };
  files["assets/app.js"].viteMetadata.importedAssets.add("assets/math.worker-hash.js");
  const shell = collectShellAssets(files);
  for (const path of ["assets/index.worker-hash.js", "assets/browserSnapshot.worker-hash.js", "assets/sheetSummary.worker-hash.js", "assets/search.worker-hash.js", "assets/inspectorMentions.worker-hash.js", "assets/tidy.worker-hash.js", "assets/wa-sqlite-async-hash.js", "assets/sqlite-api-hash.js"]) assert.equal(shell.has(path), true, path);
  assert.equal(shell.has("assets/math.worker-hash.js"), false);
});
test("keeps first-party interfaces and library factories available for cold offline commands", () => {
  const files = bundle();
  files["assets/about.js"] = { type: "chunk", fileName: "assets/about.js", modules: { "C:/repo/packages/ui/src/BrowserInfoDialog.tsx": {} }, imports: [], viteMetadata: metadata(["assets/about.css"]) };
  files["assets/templates.js"] = { type: "chunk", fileName: "assets/templates.js", modules: { "/repo/packages/core/src/templates.ts": {} }, imports: [] };
  files["assets/store.js"] = { type: "chunk", fileName: "assets/store.js", modules: { "/repo/packages/storage/src/browserTemplates.ts": {} }, imports: [] };
  files["assets/workbox-window.prod.es5-hash.js"] = { type: "chunk", fileName: "assets/workbox-window.prod.es5-hash.js", imports: [] };
  files["assets/mermaid.js"] = { type: "chunk", fileName: "assets/mermaid.js", modules: { "/repo/node_modules/mermaid/dist/index.js": {} }, imports: [] };
  const shell = collectShellAssets(files);
  for (const path of ["assets/about.js", "assets/about.css", "assets/templates.js", "assets/store.js", "assets/workbox-window.prod.es5-hash.js"]) assert.equal(shell.has(path), true, path);
  assert.equal(shell.has("assets/mermaid.js"), false);
});
test("precaches shell, fonts, WASM and install icons while retaining original revision/integrity records", () => {
  const shell = collectShellAssets(bundle());
  const urls = [...shell, "assets/font.woff2", "assets/index.wasm", "brand/icon-512.png", "assets/math.js", "assets/diagram.js", "assets/math.css"];
  const entries = urls.map(url => ({ url, revision: "unchanged", integrity: "digest" }));
  const selected = selectShellManifest(entries, shell);
  assert.deepEqual(selected.manifest.map(entry => entry.url), [...shell, "assets/font.woff2", "assets/index.wasm", "brand/icon-512.png"]);
  assert.equal(selected.manifest[0], entries[0]);
  assert.deepEqual(selected.warnings, []);
});
test("accepts generated relative URLs but refuses to silently omit a critical shell resource", () => {
  const entry = { url: "./assets/app.js", revision: null };
  assert.deepEqual(selectShellManifest([entry], new Set(["assets/app.js"])).manifest, [entry]);
  assert.throws(() => selectShellManifest([entry], new Set(["index.html"])), /missing from the precache/);
  assert.throws(() => selectShellManifest([entry], new Set()), /Collect the built app shell/);
});
test("the build plugin emits the migration from its final graph and resets between builds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "slate-precache-"));
  try {
    const value = shellPrecache();
    value.plugin.writeBundle.call({}, { dir }, bundle());
    const script = readFileSync(join(dir, "cache-migrate.js"), "utf8");
    assert.match(script, /"assets\/math.js"/); assert.match(script, /"assets\/diagram.js"/);
    assert.doesNotMatch(script, /"assets\/app.js"/);
    const entries = [...collectShellAssets(bundle())].map(url => ({ url }));
    assert.equal((await value.transform(entries)).manifest.length, entries.length);
    value.plugin.buildStart.call({}, {});
    await assert.rejects(value.transform(entries), /Collect the built app shell/);
  } finally { unlinkSync(join(dir, "cache-migrate.js")); rmdirSync(dir); }
});
