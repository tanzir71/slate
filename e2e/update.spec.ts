import { expect, test } from "./fixtures";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { createSheet, openLibrary } from "./helpers";

test("a deployed service-worker update waits for Reload and flushes typing first", async ({ createContext }) => {
  const root = resolve("site-dist");
  let version = 1;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const relative = url.pathname.replace(/^\/slate\//, "");
    const path = resolve(root, relative.endsWith("/") ? `${relative}index.html` : relative);
    if (!path.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
    try {
      let body: Uint8Array | string = await readFile(path);
      if (path.endsWith(`${sep}sw.js`)) body = `${body.toString()}\n// deployed-version-${version}`;
      if (path.endsWith(`${sep}whats-new.json`)) body = JSON.stringify({ version: version === 1 ? "0.2.0" : "0.2.1", title: "A fresh release", changes: ["New release notes, same files."] });
      const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
      response.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  const context = await createContext({ baseURL: `http://127.0.0.1:${address.port}/slate/app/` });
  try {
    const page = await context.newPage();
    await openLibrary(page);
    await createSheet(page, "# Updates\n\nOriginal words.");
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    version = 2;
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration?.update(); });
    const reload = page.getByRole("button", { name: "Reload", exact: true });
    await expect(reload).toBeVisible();
    await expect(page.locator(".browserSlate > .notice")).toContainText("Slate 0.2.1 is ready");
    await context.setOffline(true);
    await page.getByRole("button", { name: "About Slate", exact: true }).click();
    const currentDialog = page.getByRole("dialog", { name: "About Slate" });
    await expect(currentDialog.getByRole("heading", { name: "What’s new in Slate 0.2.0", exact: true })).toBeVisible();
    await currentDialog.getByRole("button", { name: "Close", exact: true }).click();
    await context.setOffline(false);
    await page.getByRole("button", { name: "What’s new", exact: true }).click();
    const releaseDialog = page.getByRole("dialog", { name: "About Slate" });
    await expect(releaseDialog.getByRole("heading", { name: "What’s new in Slate 0.2.1", exact: true })).toBeVisible();
    await releaseDialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText(" Typed before reload.");
    await reload.click();
    await expect(page.locator(".cm-content")).toContainText("Typed before reload.");
    await expect(reload).toBeHidden();
    await page.reload();
    await expect(page.locator(".cm-content")).toContainText("Typed before reload.");
  } finally {
    await context.close();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});
