import { spawnSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { desktopPlatforms, findBundle, previewFilename, readDesktopVersion, stageDesktopArtifact } from "./desktop-artifacts.mjs";

const root = resolve(import.meta.dirname, "..");
const platform = process.platform;
const target = desktopPlatforms[platform];
if (!target || (platform !== "darwin" && process.arch !== "x64")) throw new Error("Build previews on native Windows/Linux x64 or macOS runners.");
const version = await readDesktopVersion(root, process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run pnpm build:desktop-preview.");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
  return result.stdout?.trim();
}
const commit = run("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
const dirty = Boolean(run("git", ["status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" }));
run(process.execPath, [pnpm, "--filter", "@slate/desktop", "exec", "tauri", "build",
  "--config", "src-tauri/tauri.preview.conf.json", "--bundles", target.bundle, "--no-sign", "--ci",
  ...(platform === "darwin" ? ["--target", "universal-apple-darwin"] : []),
  "--", "--locked",
], { stdio: "inherit" });
const directory = resolve(root, "apps/desktop/src-tauri/target", target.directory);
const output = resolve(root, "artifacts/desktop-preview", target.id, version);
let source;
if (platform === "darwin") {
  const app = await findBundle(directory, ".app", true);
  const architectures = run("lipo", ["-archs", resolve(app, "Contents/MacOS/slate-desktop")], { encoding: "utf8" });
  if (!architectures?.includes("x86_64") || !architectures.includes("arm64")) throw new Error("macOS preview must contain both Intel and Apple Silicon binaries.");
  // ditto preserves app permissions, symlinks and resource forks inside the ZIP.
  source = resolve(directory, previewFilename(version, platform));
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, source], { stdio: "inherit" });
} else source = await findBundle(directory, target.extension, false, version);
const record = await stageDesktopArtifact({ source, output, version, commit, platform, dirty });
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `artifact_directory=${output}\n`);
console.log(`Unsigned desktop preview: ${record.filename} (${record.bytes} bytes), SHA-256 ${record.sha256}${dirty ? " (local working changes; cannot publish)" : ""}`);
