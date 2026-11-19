import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import browser from "../../playwright.config.ts";

const source = async (path) =>
  (await readFile(new URL(path, import.meta.url), "utf8")).replaceAll(
    "\r\n",
    "\n",
  );
const workflow = await source("../../.github/workflows/pages.yml");
const deployStart = workflow.indexOf("\n  deploy:\n");
const deployEnd = workflow.indexOf("\n  release:\n", deployStart);
assert.ok(
  deployStart >= 0 && deployEnd > deployStart,
  "publication jobs must be present",
);
const deploy = workflow.slice(deployStart, deployEnd);
const upload = deploy.indexOf("uses: actions/upload-pages-artifact");
const publish = deploy.indexOf("uses: actions/deploy-pages");

test("functional and fresh-browser timing configs retain every Linux reference profile", async () => {
  assert.deepEqual(
    browser.projects.map((project) => project.name),
    ["chromium", "firefox", "webkit", "mobile"],
  );
  for (const path of [
    "../../playwright.performance.config.ts",
    "../../playwright.block-menu-performance.config.ts",
    "../../playwright.tidy-performance.config.ts",
    "../../playwright.palette-performance.config.ts",
  ]) {
    const config = await source(path);
    assert.match(config, /\.\.\.base\s*,/);
    assert.doesNotMatch(
      config,
      /^\s*projects\s*:/m,
      `${path} must inherit all reference profiles`,
    );
  }
});
for (const command of [
  "pnpm e2e",
  "pnpm perf:tidy",
  "pnpm perf:menu",
  "pnpm perf:typing",
  "pnpm perf:palette",
]) {
  test(`publication runs ${command} with every profile before uploading or deploying`, () => {
    const runs = [...deploy.matchAll(/^ {6}- run: (.+)$/gm)];
    const gate = runs.find((match) => match[1] === command);
    assert.ok(gate, `${command} must run without project filters`);
    assert.ok(
      gate.index < upload && upload < publish,
      "verification must finish before Pages upload/deploy",
    );
    assert.doesNotMatch(
      deploy,
      /continue-on-error\s*:/,
      "publication failures cannot be optional",
    );
  });
}
