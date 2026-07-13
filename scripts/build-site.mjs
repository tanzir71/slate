import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "site-dist");
const pnpmScript = process.env.npm_execpath;
if (!pnpmScript)
  throw new Error("pnpm entrypoint was not provided by the package manager");
const build = spawnSync(
  process.execPath,
  [pnpmScript, "--filter", "@slate/web", "build"],
  {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "demo"), { recursive: true });
await cp(resolve(root, "docs"), output, { recursive: true });
await cp(resolve(root, "apps/web/dist"), resolve(output, "demo"), {
  recursive: true,
});
console.log("Slate site assembled in site-dist/ with the real PWA at /demo/.");
