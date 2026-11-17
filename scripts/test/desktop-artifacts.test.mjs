import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { desktopPlatforms, findBundle, hasDesktopPreviews, previewFilename, readDesktopVersion, renderDesktopPreviewCTA, stageDesktopArtifact, verifyDesktopArtifacts } from "../desktop-artifacts.mjs";

const commit = "a".repeat(40);
test("preview release policy starts at v0.3 and rejects unsafe versions", () => {
  assert.equal(hasDesktopPreviews("0.2.1"), false);
  for (const version of ["0.3.0", "0.10.0", "1.0.0", "0.3.0-beta.1"]) assert.equal(hasDesktopPreviews(version), true);
  for (const version of ["../0.3.0", "v0.3.0", "0.3", "03.0.0"]) assert.throws(() => hasDesktopPreviews(version));
});

test("landing advertises only the matching release's available desktop previews", () => {
  const html = '<!-- secondary-cta:start --><a>View source</a><!-- secondary-cta:end -->';
  assert.equal(renderDesktopPreviewCTA(html, "0.2.1"), html);
  const next = renderDesktopPreviewCTA(html, "0.3.0");
  assert.match(next, /releases\/tag\/v0.3.0/);
  assert.match(next, /Desktop preview \(unsigned builds\)/);
  assert.doesNotMatch(next, /View source/);
  assert.throws(() => renderDesktopPreviewCTA("missing marker", "0.3.0"), /exactly one/);
});

test("desktop packaging rejects mismatched package, Rust or tag versions", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "slate-desktop-version-"));
  await mkdir(resolve(root, "apps/desktop/src-tauri"), { recursive: true });
  for (const filename of ["package.json", "apps/desktop/package.json", "apps/desktop/src-tauri/tauri.conf.json"])
    await writeFile(resolve(root, filename), '{"version":"0.3.0"}');
  const cargo = resolve(root, "apps/desktop/src-tauri/Cargo.toml");
  await writeFile(cargo, '[package]\nname = "slate-desktop"\nversion = "0.3.0"\n[dependencies]\nother = { version = "99" }\n');
  assert.equal(await readDesktopVersion(root, "v0.3.0"), "0.3.0");
  await assert.rejects(readDesktopVersion(root, "v0.4.0"), /tag/);
  await writeFile(cargo, '[package]\nversion = "0.2.1"');
  await assert.rejects(readDesktopVersion(root), /versions must agree/);
  await writeFile(cargo, '[package]\nversion = "0.3.0"');
  await writeFile(resolve(root, "apps/desktop/package.json"), '{"version":"0.2.1"}');
  await assert.rejects(readDesktopVersion(root), /versions must agree/);
});

test("artifact selection refuses missing and ambiguous bundles", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "slate-bundles-"));
  await assert.rejects(findBundle(root, ".exe"), /found 0/);
  await writeFile(resolve(root, "first.exe"), "MZ");
  assert.equal(await findBundle(root, ".exe"), resolve(root, "first.exe"));
  await writeFile(resolve(root, "second.exe"), "MZ");
  await assert.rejects(findBundle(root, ".exe"), /found 2/);
  await writeFile(resolve(root, "Slate Preview_0.3.0_x64-setup.exe"), "MZ");
  assert.equal(await findBundle(root, ".exe", false, "0.3.0"), resolve(root, "Slate Preview_0.3.0_x64-setup.exe"));
  await mkdir(resolve(root, "Slate Preview.app"));
  assert.equal(await findBundle(root, ".app", true), resolve(root, "Slate Preview.app"));
});

test("release verification requires all platforms, exact commit and unmodified bytes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "slate-desktop-artifacts-"));
  const output = resolve(root, "release");
  for (const [platform, magic] of [["win32", "MZ"], ["linux", "\x7fELF"], ["darwin", "PK"]]) {
    const source = resolve(root, platform);
    const bytes = Buffer.from(`${magic}preview fixture`);
    await writeFile(source, bytes);
    const record = await stageDesktopArtifact({ source, output, platform, version: "0.3.0", commit, dirty: false });
    assert.equal(record.platform, desktopPlatforms[platform].id);
    assert.equal(record.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(await readFile(resolve(output, record.filename)), bytes);
    if (platform === "win32") await assert.rejects(verifyDesktopArtifacts(output, "0.3.0", commit), /ENOENT/);
  }
  assert.equal((await verifyDesktopArtifacts(output, "0.3.0", commit)).length, 9);
  const macRecord = resolve(output, `${previewFilename("0.3.0", "darwin")}.json`);
  const original = await readFile(macRecord, "utf8");
  await writeFile(macRecord, JSON.stringify({ ...JSON.parse(original), dirty: true }));
  await assert.rejects(verifyDesktopArtifacts(output, "0.3.0", commit), /mismatch/);
  await writeFile(macRecord, original);
  await assert.rejects(verifyDesktopArtifacts(output, "0.3.0", "b".repeat(40)), /mismatch/);
  const windows = resolve(output, previewFilename("0.3.0", "win32"));
  await writeFile(windows, "changed after staging");
  await assert.rejects(verifyDesktopArtifacts(output, "0.3.0", commit), /mismatch/);
  await assert.rejects(stageDesktopArtifact({ source: windows, output, platform: "win32", version: "0.3.0", commit, dirty: false }), /bundle header/);
});
