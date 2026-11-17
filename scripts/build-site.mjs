import { cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { transformWithEsbuild } from "vite";

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

for (const script of ["prepare-marketing.mjs", "shots.mjs"]) {
  const prepared = spawnSync(
    process.execPath,
    [resolve(root, "scripts", script)],
    { cwd: root, stdio: "inherit" },
  );
  if (prepared.error) throw prepared.error;
  if (prepared.status !== 0) process.exit(prepared.status ?? 1);
}

if (output !== resolve(root, "site-dist"))
  throw new Error("Refusing to clear a path outside the site output");
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "demo"), { recursive: true });
await cp(resolve(root, "docs"), output, { recursive: true });
for (const [filename, loader] of [["landing.css", "css"], ["landing.js", "js"]]) {
  const source = await readFile(resolve(output, filename), "utf8");
  const result = await transformWithEsbuild(source, filename, { loader, minify: true });
  await writeFile(resolve(output, filename), result.code);
}
const landing = await readFile(resolve(output, "index.html"), "utf8");
const landingCss = await readFile(resolve(output, "landing.css"), "utf8");
await writeFile(resolve(output, "index.html"), landing.replace('<link rel="stylesheet" href="./landing.css" />', `<style>${landingCss}</style>`).replace(/<img\b([^>]*?)>/g, (tag, attributes) => {
  let result = /\bwidth=/.test(attributes) ? tag : tag.replace("<img", '<img width="20" height="20"');
  if (attributes.includes("./assets/icons/") && !/globe|code\.svg|check\.svg|menu\.svg|arrowRight/.test(attributes)) result = result.replace("<img", '<img loading="lazy" decoding="async"');
  return result;
}).replace(/>\s+</g, "><"));
await cp(resolve(root, "apps/web/dist"), resolve(output, "app"), {
  recursive: true,
});
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
await writeFile(resolve(output, "release.json"), `${JSON.stringify({ version: process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME.replace(/^v/, "") : manifest.version, commit: git.status === 0 ? git.stdout.trim() : null, landing: "./", app: "./app/" }, null, 2)}\n`);
await writeFile(
  resolve(output, "demo/index.html"),
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=../app/?sample=1"><title>Open Slate</title><a href="../app/?sample=1">Open the Sample Space</a></html>',
);
await writeFile(
  resolve(output, "404.html"),
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/slate/app/"><title>Open Slate</title><a href="/slate/app/">Open Slate</a></html>',
);
console.log(
  "Slate site assembled in site-dist/ with the app at /app/ and a /demo/ redirect.",
);
