import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { expect, test } from "./fixtures";
import { createSheet, expectSavedSheet, openLibrary } from "./helpers";

test("used math and diagrams survive migration from all-chunk precaching to a lazy worker", async ({ createContext }, info) => {
  const root = resolve("site-dist"), assets = await readdir(resolve(root, "app/assets"));
  const math = assets.find(name => /^math\.worker-.*\.js$/.test(name));
  if (!math) throw Error("No actual math worker");
  const renderer = (await readFile(resolve(root, "app/diagram-preview.html"), "utf8")).match(/src="\.\/assets\/([^"]+\.js)"/)?.[1];
  if (!renderer) throw Error("No diagram bootstrap");
  let version = 1, offline = false;
  const server = createServer(async (request, response) => {
    if (offline) { response.writeHead(503).end("Server disconnected"); return; }
    const url = new URL(request.url ?? "/", "http://localhost");
    const relative = decodeURIComponent(url.pathname).replace(/^\/slate\//, "");
    const path = resolve(root, relative.endsWith("/") ? relative + "index.html" : relative);
    if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try {
      let body: Uint8Array | string = path.endsWith(sep + "diagram-legacy.js") ? `import "./${renderer}";` : await readFile(path);
      if (version === 1 && path.endsWith(sep + "diagram-preview.html")) body = body.toString().replaceAll(renderer, "diagram-legacy.js");
      if (path.endsWith(sep + "sw.js")) {
        let script = body.toString();
        if (version === 1) {
          // Model the previous all-chunk policy without running the new migration.
          script = script.replace(/importScripts\("cache-migrate.js"\)/, "void 0");
          // Legacy fallback was network-only; the exporting renderer keeps one module identity.
          script = script.replace(/new \w+\.CacheFirst\(/g, "new (class { handle({request}) { return fetch(request); } })(");
          const marker = "precacheAndRoute(", start = script.indexOf(marker) + marker.length, end = script.indexOf("],", start) + 1;
          if (start < marker.length || end < 1) throw Error("No generated precache array");
          const manifest = (JSON.parse(script.slice(start, end).replace(/([{,])(\w+):/g, '$1"$2":')) as { url: string; revision: string | null }[])
            .filter(entry => entry.url !== "cache-migrate.js" && entry.url !== "assets/" + renderer)
            .map(entry => entry.url === "diagram-preview.html" ? { ...entry, revision: "legacy-diagram-document" } : entry);
          const urls = new Set(manifest.map(entry => entry.url));
          for (const file of [...assets.filter(name => name !== renderer).map(name => "assets/" + name), "diagram-preview.html", "assets/diagram-legacy.js"])
            if (!urls.has(file)) manifest.push({ url: file, revision: null });
          script = script.slice(0, start) + JSON.stringify(manifest) + script.slice(end);
        }
        body = script + "\n// cache-policy-" + version;
      }
      const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json" };
      response.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test server");
  const context = await createContext({ baseURL: `http://127.0.0.1:${address.port}/slate/app/` });
  try {
    const page = await context.newPage();
    await openLibrary(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const source = "# Archived math\n\n$x_i$\n\n```mermaid\nflowchart LR\n A[Saved] --> B[Offline]\n```\n\nSaved words.";
    await createSheet(page, source); await expectSavedSheet(page, source);
    const preview = page.frameLocator('iframe[title="Math preview"]').locator("math");
    await expect(preview).toBeVisible();
    await expect(page.frameLocator('iframe[title="Diagram preview"]').locator("svg")).toBeVisible();
    const mathURL = page.url();
    const cached = () => page.evaluate(async name => !!await caches.match(new URL("./assets/" + name, document.baseURI)), math);
    expect(await cached()).toBe(true);
    const rendererCached = () => page.evaluate(async name => !!await caches.match(new URL("./assets/" + name, document.baseURI)), renderer);
    expect(await rendererCached()).toBe(false);
    await createSheet(page, "# Current plain note\n\nKeep this open during the update.");
    version = 2;
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
    const reload = page.getByRole("button", { name: "Reload", exact: true });
    await expect(reload).toBeVisible(); await reload.click();
    await expect(page.locator(".cm-content")).toContainText("Keep this open during the update.");
    await expect(reload).toBeHidden();
    await info.attach("post-update-cache", { body: JSON.stringify({ mathCached: await cached() }), contentType: "application/json" });
    expect(await cached()).toBe(true);
    expect(await rendererCached()).toBe(true);
    offline = true; await context.setOffline(true);
    await page.goto(mathURL, { waitUntil: "domcontentloaded" });
    await expect(preview).toBeVisible();
    await expect(page.frameLocator('iframe[title="Diagram preview"]').locator("svg")).toBeVisible();
    await expectSavedSheet(page, source);
  } finally {
    await context.close();
    await new Promise<void>(done => server.close(() => done()));
  }
});
