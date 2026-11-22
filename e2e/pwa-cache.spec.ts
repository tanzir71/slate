import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { expect, test } from "./fixtures";
import { createSheet, expectSavedSheet, openLibrary, replaceEditorText } from "./helpers";

for (const early of [false, true]) test(`unused feature chunks stay lazy and first-use math ${early ? "before worker control" : "after worker control"} reopens with both browser and server offline`, async ({ createContext }, info) => {
  const root = resolve("site-dist"), assets = await readdir(resolve(root, "app/assets"));
  const unused = assets.find(name => /^elk-.*\.js$/.test(name));
  const math = assets.find(name => /^math\.worker-.*\.js$/.test(name));
  expect(unused).toBeDefined(); expect(math).toBeDefined();
  let offline = false;
  let releaseInstall: () => void = () => {};
  const installGate = new Promise<void>(done => { releaseInstall = done; });
  let installHeld = false;
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push(url.pathname);
    if (offline) { response.writeHead(503).end("Server disconnected"); return; }
    if (early && url.pathname.endsWith("/brand/icon-maskable-512.png")) {
      installHeld = true;
      await installGate;
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/slate\//, "");
    const path = resolve(root, relative.endsWith("/") ? relative + "index.html" : relative);
    if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json" };
      response.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cache test server did not start");
  const context = await createContext({ baseURL: `http://127.0.0.1:${address.port}/slate/app/` });
  try {
    const page = await context.newPage();
    await openLibrary(page); await createSheet(page, "# Cached writing\n\nPlain words.");
    if (early) {
      await expect.poll(() => installHeld).toBe(true);
      expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    } else {
      await page.evaluate(() => navigator.serviceWorker.ready);
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    }
    const cached = (name: string) => page.evaluate(async name => !!await caches.match(new URL("./assets/" + name, document.baseURI)), name);
    expect(await cached(unused!)).toBe(false);
    expect(requests.some(path => path.endsWith("/" + unused))).toBe(false);
    expect(await cached(math!)).toBe(false);
    const source = "# Cached writing\n\n$x_i$\n\nSaved words.";
    await replaceEditorText(page, source); await expectSavedSheet(page, source);
    const preview = page.frameLocator('iframe[title="Math preview"]').locator("math");
    await expect(preview).toBeVisible();
    expect(requests.some(path => path.endsWith("/" + math))).toBe(true);
    await expect.poll(() => cached(math!)).toBe(true);
    expect(await cached(unused!)).toBe(false);
    releaseInstall();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    offline = true;
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".cm-content")).toBeVisible();
    await expect(preview).toBeVisible(); await expectSavedSheet(page, source);
    await page.screenshot({ path: info.outputPath("first-use-math-offline.png") });
  } finally {
    releaseInstall();
    await context.close();
    await new Promise<void>(done => server.close(() => done()));
  }
});
