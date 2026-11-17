import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

export const desktopPlatforms = {
  win32: { id: "windows-x64", bundle: "nsis", extension: ".exe", directory: "release/bundle/nsis" },
  linux: { id: "linux-x64", bundle: "appimage", extension: ".AppImage", directory: "release/bundle/appimage" },
  darwin: { id: "macos-universal", bundle: "app", extension: ".app.zip", directory: "universal-apple-darwin/release/bundle/macos" },
};

export function hasDesktopPreviews(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.-]+)?$/.exec(version);
  if (!match) throw new Error(`Invalid release version: ${version}`);
  return Number(match[1]) > 0 || Number(match[2]) >= 3;
}

export function renderDesktopPreviewCTA(html, version) {
  if (!hasDesktopPreviews(version)) return html;
  const marker = /<!-- secondary-cta:start -->[\s\S]*?<!-- secondary-cta:end -->/g;
  if ([...html.matchAll(marker)].length !== 1) throw new Error("Landing must have exactly one secondary CTA marker.");
  return html.replace(marker, `<a class="button secondary" href="https://github.com/tanzir71/slate/releases/tag/v${version}" aria-label="Desktop preview (unsigned builds)"><img class="icon" src="./assets/icons/download.svg" alt="" />Desktop preview</a>`);
}

export async function readDesktopVersion(root, tag) {
  const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
  const [manifest, desktop, config, cargo] = await Promise.all([
    json("package.json"), json("apps/desktop/package.json"), json("apps/desktop/src-tauri/tauri.conf.json"),
    readFile(resolve(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8"),
  ]);
  const rustVersion = cargo.split("[package]")[1]?.split(/\r?\n\[/)[0]?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  hasDesktopPreviews(manifest.version);
  if ([desktop.version, config.version, rustVersion].some((version) => version !== manifest.version))
    throw new Error("Root, desktop package, Tauri and Rust release versions must agree.");
  if (tag && tag !== `v${manifest.version}`) throw new Error(`Release tag ${tag} must match v${manifest.version}`);
  return manifest.version;
}

export function previewFilename(version, platform) {
  hasDesktopPreviews(version);
  const target = desktopPlatforms[platform];
  if (!target) throw new Error(`Unsupported desktop platform: ${platform}`);
  return `Slate_${version}_${target.id}-preview-unsigned${target.extension}`;
}

export async function findBundle(directory, extension, isDirectory = false, version) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() === isDirectory && entry.name.endsWith(extension) && (!version || entry.name.includes(`_${version}_`)));
  if (entries.length !== 1) throw new Error(`Expected one ${extension} bundle in ${directory}; found ${entries.length}`);
  return resolve(directory, entries[0].name);
}

export async function stageDesktopArtifact({ source, output, version, commit, platform, dirty }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Desktop artifacts require a full Git commit SHA.");
  if (typeof dirty !== "boolean") throw new Error("Desktop artifacts require an explicit working-tree state.");
  const filename = previewFilename(version, platform);
  const bytes = await readFile(source);
  const magic = platform === "win32" ? [0x4d, 0x5a] : platform === "linux" ? [0x7f, 0x45, 0x4c, 0x46] : [0x50, 0x4b];
  if (!magic.every((byte, index) => bytes[index] === byte)) throw new Error(`Invalid ${platform} bundle header`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await mkdir(output, { recursive: true });
  const destination = resolve(output, filename);
  if (resolve(source) !== destination) await copyFile(source, destination);
  const record = { version, commit, dirty, platform: desktopPlatforms[platform].id, unsigned: true, filename, bytes: bytes.length, sha256 };
  await writeFile(resolve(output, `${filename}.json`), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(resolve(output, `${filename}.sha256`), `${sha256}  ${basename(destination)}\n`);
  return record;
}

export async function verifyDesktopArtifacts(directory, version, commit) {
  const files = await readdir(directory);
  const expected = new Set();
  for (const platform of Object.keys(desktopPlatforms)) {
    const filename = previewFilename(version, platform);
    for (const suffix of ["", ".json", ".sha256"]) expected.add(`${filename}${suffix}`);
    const record = JSON.parse(await readFile(resolve(directory, `${filename}.json`), "utf8"));
    const bytes = await readFile(resolve(directory, filename));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (record.version !== version || record.commit !== commit || record.dirty !== false || record.filename !== filename || record.platform !== desktopPlatforms[platform].id || record.unsigned !== true || record.bytes !== bytes.length || record.sha256 !== hash)
      throw new Error(`Desktop artifact metadata or checksum mismatch: ${filename}`);
    if (await readFile(resolve(directory, `${filename}.sha256`), "utf8") !== `${hash}  ${filename}\n`)
      throw new Error(`Desktop checksum file mismatch: ${filename}`);
  }
  if (files.length !== expected.size || files.some((file) => !expected.has(file)))
    throw new Error("Desktop release assets contain unexpected files.");
  return [...expected];
}
