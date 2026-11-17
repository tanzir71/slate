import { cp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { transformWithEsbuild } from "vite";
import { assertReleaseMetadata } from "./release-metadata.mjs";
import { renderDesktopPreviewCTA } from "./desktop-artifacts.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "site-dist");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const appManifest = JSON.parse(await readFile(resolve(root, "apps/web/package.json"), "utf8"));
const releaseNotes = JSON.parse(await readFile(resolve(root, "apps/web/public/whats-new.json"), "utf8"));
assertReleaseMetadata({ version: manifest.version, appVersion: appManifest.version, notesVersion: releaseNotes.version }, process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
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
const landing = renderDesktopPreviewCTA(await readFile(resolve(output, "index.html"), "utf8"), manifest.version);
let landingCss = await readFile(resolve(output, "landing.css"), "utf8");
for (const font of ["geist", "newsreader", "geist-mono"]) {
  const bytes = await readFile(resolve(output, "assets/fonts", `${font}.woff2`));
  landingCss = landingCss.replace(`./assets/fonts/${font}.woff2`, `data:font/woff2;base64,${bytes.toString("base64")}`);
}
const lockup = (await readFile(resolve(output, "assets/brand/logo-lockup.svg"), "utf8"))
  .replace('<svg width="86" height="32"', '<svg width="104" height="28" aria-hidden="true"');
const iconFiles = (await readdir(resolve(output, "assets/icons"))).filter((name) => name.endsWith(".svg"));
const inlineIcons = new Map(await Promise.all(iconFiles.map(async (name) => [name, await readFile(resolve(output, "assets/icons", name), "utf8")])));
let lockupInlined = false;
await writeFile(resolve(output, "index.html"), landing.replace(/<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="font")[^>]*>/g, "").replace('<link rel="stylesheet" href="./landing.css" />', `<style>${landingCss}</style>`).replace(/<img\b([^>]*?)>/g, (tag, attributes) => {
  if (attributes.includes("./assets/brand/logo-lockup.svg")) {
    if (!lockupInlined) { lockupInlined = true; return lockup; }
    return tag.replace("<img", '<img loading="lazy" decoding="async"');
  }
  const icon = attributes.match(/src="\.\/assets\/icons\/([^"/]+\.svg)"/)?.[1];
  if (icon && inlineIcons.has(icon)) {
    const className = attributes.match(/class="([^"]*)"/)?.[1] ?? "";
    return inlineIcons.get(icon).replace(/class="([^"]*)"/, `class="$1 ${className}"`);
  }
  return /\bwidth=/.test(attributes) ? tag : tag.replace("<img", '<img width="20" height="20"');
}).replace(/>\s+</g, "><"));
await cp(resolve(root, "apps/web/dist"), resolve(output, "app"), {
  recursive: true,
});
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
