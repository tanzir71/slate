import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createStaticFileServer } from "./serve-static.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "artifacts/lighthouse-landing.json");
await mkdir(resolve(root, "artifacts"), { recursive: true });
const server = createStaticFileServer(resolve(root, "site-dist"), "/slate");
await new Promise((done) => server.listen(0, "127.0.0.1", done));
try {
  const args = [resolve(root, "node_modules/lighthouse/cli/index.js"), `http://127.0.0.1:${server.address().port}/slate/`, "--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage", "--only-categories=performance,accessibility,best-practices,seo", "--output=json", `--output-path=${output}`, "--quiet"];
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, CHROME_PATH: chromium.executablePath() } });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? done() : reject(new Error(`Lighthouse exited ${code}`)));
  });
  const report = JSON.parse(await readFile(output, "utf8"));
  const failures = [];
  for (const name of ["performance", "accessibility", "best-practices", "seo"]) {
    const score = (report.categories[name]?.score ?? 0) * 100;
    console.log(`Landing ${name}: ${score}/100 (budget >= 95)`);
    if (score < 95) failures.push(`${name} is below 95`);
  }
  const lcp = report.audits["largest-contentful-paint"].numericValue;
  const cls = report.audits["cumulative-layout-shift"].numericValue;
  console.log(`LCP: ${Math.round(lcp)} ms (budget < 1500 ms); CLS: ${cls.toFixed(3)} (budget < 0.02)`);
  if (lcp >= 1500) failures.push("LCP exceeds 1.5 s");
  if (cls >= 0.02) failures.push("CLS exceeds 0.02");
  if (failures.length) throw new Error(failures.join("; "));
} finally { await new Promise((done) => server.close(done)); }
