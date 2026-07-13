import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "docs/index.html"), "utf8");
const bytes = (await stat(resolve(root, "docs/index.html"))).size;
const required = [
  "Ulysses-calm writing. Obsidian-grade ownership. Web + desktop, free.",
  "./demo/",
  "REAL SEEDED PWA",
  "mobile is a placeholder",
  "tanziro.com",
  "buy me a coffee",
];
const failures = required
  .filter((value) => !html.toLowerCase().includes(value.toLowerCase()))
  .map((value) => `Missing: ${value}`);
if (bytes > 150_000)
  failures.push(`Landing page is ${bytes} bytes; expected <= 150000`);
if (/<script[^>]+src=|<link[^>]+stylesheet/i.test(html))
  failures.push("Landing page has an external runtime dependency");
if (!html.includes('class="skip"') || !html.includes("prefers-reduced-motion"))
  failures.push("Accessibility hooks are missing");
const demoHtml = await readFile(
  resolve(root, "site-dist/demo/index.html"),
  "utf8",
);
if (
  !demoHtml.includes("./assets/") ||
  /(?:src|href)="\/assets\//.test(demoHtml)
)
  failures.push("Demo assets are not subpath-safe");
if (!demoHtml.includes("./manifest.webmanifest"))
  failures.push("Demo manifest is not relative to /demo/");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `Slate landing page and subpath-safe PWA verified (${bytes} bytes).`,
);
