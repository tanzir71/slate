import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hasDesktopPreviews, readDesktopVersion, verifyDesktopArtifacts } from "./desktop-artifacts.mjs";

const root = resolve(import.meta.dirname, "..");
const tag = process.env.RELEASE_TAG;
if (!tag) throw new Error("RELEASE_TAG is required.");
const version = await readDesktopVersion(root, tag);
function gh(args) {
  const result = spawnSync("gh", args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `gh exited ${result.status}`);
  return result.stdout;
}
const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
if (git.status !== 0) throw new Error("Cannot identify the release commit.");
const directory = resolve(root, "artifacts/release-desktop");
// Verify every platform and byte before creating or changing a GitHub release.
const assets = hasDesktopPreviews(version) ? await verifyDesktopArtifacts(directory, version, git.stdout.trim()) : [];
const existing = spawnSync("gh", ["release", "view", tag, "--json", "isDraft"], { cwd: root, encoding: "utf8", windowsHide: true });
let draft = true;
if (existing.status === 0) draft = JSON.parse(existing.stdout).isDraft;
else {
  const notes = resolve(root, `RELEASE_NOTES_${tag}.md`);
  const hasNotes = await stat(notes).then(() => true, () => false);
  const body = hasNotes ? await readFile(notes, "utf8") : "";
  const previewNote = assets.length ? `\n\nDesktop downloads are **unsigned previews** with no automatic updater. The browser app remains the recommended writing workspace. Read [platform instructions and current native limitations](https://github.com/${process.env.GITHUB_REPOSITORY || "tanzir71/slate"}/blob/${tag}/docs/desktop-preview.md) before using them. Each download includes its SHA-256 and source-commit manifest.\n` : "";
  await mkdir(resolve(root, "artifacts"), { recursive: true });
  const preparedNotes = resolve(root, "artifacts/release-notes.md");
  await writeFile(preparedNotes, body + previewNote);
  gh(["release", "create", tag, "--verify-tag", "--draft", "--title", `Slate ${tag}`,
    "--notes-file", preparedNotes, ...(!hasNotes ? ["--generate-notes"] : [])]);
}
if (assets.length) gh(["release", "upload", tag, ...assets.map((filename) => resolve(directory, filename)), "--clobber"]);
if (draft) gh(["release", "edit", tag, "--draft=false"]);
console.log(`Release ${tag} published with ${assets.length ? "three unsigned desktop previews and their checksums" : "the verified browser app"}.`);
