import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const read = async file => JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));
test("stable and preview bundles register Markdown with separate handler identities", async () => {
  const base = await read("../../apps/desktop/src-tauri/tauri.conf.json"), preview = await read("../../apps/desktop/src-tauri/tauri.preview.conf.json");
  for (const config of [base, preview]) {
    assert.equal(config.bundle.active, true);
    assert.equal(config.bundle.fileAssociations.length, 1);
    assert.deepEqual(config.bundle.fileAssociations[0].ext, ["md"]);
    assert.equal(config.bundle.fileAssociations[0].mimeType, "text/markdown");
    assert.equal(config.bundle.fileAssociations[0].role, "Editor");
    assert.equal(config.bundle.fileAssociations[0].rank, "Alternate");
  }
  assert.notEqual(base.bundle.fileAssociations[0].name, preview.bundle.fileAssociations[0].name);
});
test("only main can resolve an OS file ticket, with no generic file scope for a renderer", async () => {
  const main = await read("../../apps/desktop/src-tauri/capabilities/default.json"), capture = await read("../../apps/desktop/src-tauri/capabilities/capture.json");
  assert.ok(main.permissions.includes("allow-resolve-native-file"));
  assert.ok(!capture.permissions.includes("allow-resolve-native-file"));
  assert.ok(!main.permissions.some(permission => /^(?:fs|shell):/.test(permission)));
});
