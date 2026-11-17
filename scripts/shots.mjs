/* global document */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createStaticFileServer } from "./serve-static.mjs";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const server = createStaticFileServer(resolve(root, "apps/web/dist"));
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?sample=1`);
  await page.locator(".cm-content").waitFor();
  await page.getByRole("button", { name: /^Launch Plan/ }).click();
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent?.includes("Launch Plan"));
  const dismiss = page.getByRole("button", { name: "Dismiss notice" });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const directory = resolve(root, "docs/assets");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, "workspace-light.jpg"),
    type: "jpeg",
    quality: 88,
    animations: "disabled",
  });
  const mobile = await page.screenshot({ type: "png", clip: { x: 457, y: 0, width: 604, height: 480 }, animations: "disabled" });
  await sharp(mobile).avif({ quality: 60, effort: 7 }).toFile(resolve(directory, "workspace-mobile.avif"));
  await writeFile(
    resolve(directory, "screenshots.json"),
    `${JSON.stringify({ source: "real app", fixture: "Sample Space", viewport: { width: 1440, height: 900 }, light: "workspace-light.jpg", mobile: "workspace-mobile.avif", mobileCrop: { x: 457, y: 0, width: 604, height: 480 } }, null, 2)}\n`,
  );
  console.log("Captured the real app for the landing page (1440 × 900).");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
