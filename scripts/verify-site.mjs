import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "docs/index.html"), "utf8");
const bytes = (await stat(resolve(root, "docs/index.html"))).size;
const css = await readFile(resolve(root, "docs/landing.css"), "utf8");
const javascript = await readFile(resolve(root, "docs/landing.js"), "utf8");
const required = [
  "Markdown at the",
  "thought.",
  "./app/",
  "Open in your browser",
  "Designed &amp; built by",
  "free while in beta",
  "tanziro.com",
  "buy me a coffee",
];
const failures = required
  .filter((value) => !html.toLowerCase().includes(value.toLowerCase()))
  .map((value) => `Missing: ${value}`);
if (bytes > 150_000)
  failures.push(`Landing page is ${bytes} bytes; expected <= 150000`);
if (/(?:src|href)=["']https?:[^"']+\.(?:js|css|woff2?)/i.test(html) || /@import|url\(["']?https?:/i.test(css))
  failures.push("Landing page has a third-party runtime dependency");
if (Buffer.byteLength(javascript) > 10_000) failures.push("Landing JS exceeds the 10 KB budget");
if (/font-style\s*:\s*italic/i.test(css)) failures.push("Marketing type must not use italics");
if (!html.includes('class="skip"') || !css.includes("prefers-reduced-motion"))
  failures.push("Accessibility hooks are missing");
for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)) {
  if (match[1].endsWith("/")) continue;
  const asset = await stat(resolve(root, "docs", match[1])).catch(() => undefined);
  if (!asset?.size) failures.push(`Missing local landing asset: ${match[1]}`);
}
for (const font of ["geist", "newsreader", "geist-mono"]) await stat(resolve(root, "docs/assets/fonts", `${font}.woff2`));
const screenshot = JSON.parse(await readFile(resolve(root, "docs/assets/screenshots.json"), "utf8"));
if (screenshot.source !== "real app" || screenshot.fixture !== "Sample Space") failures.push("Product shot must come from the real app Sample Space");
for (const image of [screenshot.light, screenshot.mobile]) {
  if (!image || !(await stat(resolve(root, "docs/assets", image))).size) failures.push("Real desktop/mobile product capture is missing");
}
const demoHtml = await readFile(
  resolve(root, "site-dist/app/index.html"),
  "utf8",
);
if (
  !demoHtml.includes("./assets/") ||
  /(?:src|href)="\/assets\//.test(demoHtml)
)
  failures.push("App assets are not subpath-safe");
if (!demoHtml.includes("./manifest.webmanifest"))
  failures.push("App manifest is not relative to /app/");
if (!demoHtml.includes('http-equiv="Content-Security-Policy"')) failures.push("App CSP meta is missing");
const redirect = await readFile(resolve(root, "site-dist/demo/index.html"), "utf8");
if (!redirect.includes("../app/?sample=1")) failures.push("Legacy demo redirect is missing");
const manifest = JSON.parse(await readFile(resolve(root, "site-dist/app/manifest.webmanifest"), "utf8"));
if (!manifest.icons?.some((icon) => icon.purpose === "maskable") || !manifest.icons?.some((icon) => icon.sizes === "192x192")) failures.push("Installable manifest icons are missing");
await stat(resolve(root, "site-dist/app/sw.js"));
let shellSize = 0;
for (const match of demoHtml.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.js)"/g)) {
  shellSize += gzipSync(await readFile(resolve(root, "site-dist/app", match[1]))).length;
}
if (shellSize > 250 * 1024) failures.push(`Shell JS exceeds 250 KB gzip: ${shellSize}`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `Slate landing page and subpath-safe PWA verified (${bytes} bytes; shell JS ${shellSize} bytes gzip).`,
);
