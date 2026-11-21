import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
test("the capture window can append only its bound draft and cannot invoke workspace filesystem operations", async () => {
  const capture = await read("../../apps/desktop/src-tauri/capabilities/capture.json");
  const main = await read("../../apps/desktop/src-tauri/capabilities/default.json");
  assert.deepEqual(capture.windows, ["capture"]); assert.equal(capture.local, true); assert.equal(capture.remote, undefined);
  assert.deepEqual(capture.permissions.filter(permission => !permission.includes(":")), [
    "allow-capture-snapshot", "allow-stash-capture", "allow-save-capture", "allow-capture-show-main",
  ]);
  for (const permission of ["allow-set-capture-space", "allow-capture-status", "allow-open-native-capture"]) {
    assert.ok(main.permissions.includes(permission)); assert.ok(!capture.permissions.includes(permission));
  }
  for (const permission of ["allow-capture-snapshot", "allow-stash-capture", "allow-save-capture", "allow-capture-show-main"]) assert.ok(!main.permissions.includes(permission));
  assert.ok(!capture.permissions.some(permission => /^(?:fs|global-shortcut):/.test(permission)));
  delete capture.$schema;
  const generated = await read("../../apps/desktop/src-tauri/gen/schemas/capabilities.json");
  assert.deepEqual(generated.capture, capture);
});
