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
    colorScheme: "light",
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
  await page.waitForFunction(() =>
    /^Tidy · \d+$/.test(document.querySelector(".tidyStatusControl")?.textContent ?? ""),
  );
  const directory = resolve(root, "docs/assets");
  await mkdir(directory, { recursive: true });
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("dark");
    await page.waitForFunction((mode) => document.documentElement.dataset.theme === mode, theme);
    await page.screenshot({
      path: resolve(directory, `workspace-${theme}.jpg`),
      type: "jpeg",
      quality: 88,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 604, height: 480 });
    await page.getByRole("region", { name: "Editor", exact: true }).waitFor();
    const mobile = await page.screenshot({ type: "png", animations: "disabled" });
    await sharp(mobile).avif({ quality: 55, effort: 7, chromaSubsampling: "4:2:0" })
      .toFile(resolve(directory, theme === "light" ? "workspace-mobile.avif" : "workspace-mobile-dark.avif"));
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await writeFile(
    resolve(directory, "screenshots.json"),
    `${JSON.stringify({ source: "real app", fixture: "Sample Space", viewport: { width: 1440, height: 900 }, light: "workspace-light.jpg", dark: "workspace-dark.jpg", mobile: "workspace-mobile.avif", mobileDark: "workspace-mobile-dark.avif", mobileViewport: { width: 604, height: 480 } }, null, 2)}\n`,
  );
  console.log("Captured the real Light/Dark app for the landing page (1440 × 900).");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
