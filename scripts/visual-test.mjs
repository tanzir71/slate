import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const version = "1.65.1";
const reference = "mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579";
const args = process.argv.slice(2);
if (manifest.devDependencies["@playwright/test"] !== version)
  throw new Error("Update the visual reference image and review baselines when upgrading Playwright.");
if (process.env.CI && args.some((arg) => arg.startsWith("--update-snapshots") || arg.startsWith("-u")))
  throw new Error("CI may compare visual baselines; updating them requires a reviewed local change.");
await stat(resolve(root, "site-dist/app/index.html")).catch(() => {
  throw new Error("Build the actual app first with pnpm build:site.");
});
const mounts = [
  ["e2e/visual/__screenshots__", "/tmp/slate-visual/e2e/visual/__screenshots__"],
  ["test-results/visual", "/tmp/slate-visual/test-results/visual"],
  ["playwright-report/visual", "/tmp/slate-visual/playwright-report/visual"],
];
for (const [directory] of mounts) await mkdir(resolve(root, directory), { recursive: true });

// Linux dependencies stay in the ephemeral container. Host node_modules may contain Windows binaries.
const script = `
set -eu
runtime=/tmp/slate-visual
mkdir -p "$runtime/e2e/visual" "$runtime/scripts"
cp /source/playwright.visual.config.ts "$runtime/playwright.visual.config.ts"
cp /source/e2e/helpers.ts "$runtime/e2e/helpers.ts"
cp /source/e2e/libraryFiles.ts "$runtime/e2e/libraryFiles.ts"
cp /source/e2e/visual/*.ts "$runtime/e2e/visual/"
cp /source/scripts/serve-static.mjs "$runtime/scripts/serve-static.mjs"
ln -s /source/site-dist "$runtime/site-dist"
npm install --prefix "$runtime" --no-save --no-package-lock --no-audit --no-fund --prefer-offline @playwright/test@1.65.1
cd "$runtime"
node node_modules/@playwright/test/cli.js test --config=playwright.visual.config.ts "$@"
`;
const result = spawnSync("docker", [
  "run", "--rm", "--ipc=host", "--platform", "linux/amd64",
  "-v", `${root}:/source:ro`,
  ...mounts.flatMap(([directory, target]) => ["-v", `${resolve(root, directory)}:${target}`]),
  "-v", "slate-visual-npm:/root/.npm", "-e", "CI=1", reference,
  "sh", "-lc", script, "slate-visual", ...args,
], { stdio: "inherit", windowsHide: true });
if (result.error) console.error(`Start Docker to run the pinned visual reference: ${result.error.message}`);
process.exitCode = result.status ?? 1;
