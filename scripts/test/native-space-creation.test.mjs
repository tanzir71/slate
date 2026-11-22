import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("only the main window can create a named Documents Space without generic filesystem access", async () => {
  const read = async file => JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));
  const main = await read("../../apps/desktop/src-tauri/capabilities/default.json"), capture = await read("../../apps/desktop/src-tauri/capabilities/capture.json");
  assert.ok(main.permissions.includes("allow-create-native-space"));
  assert.ok(!capture.permissions.includes("allow-create-native-space"));
  assert.ok(!main.permissions.some(permission => /^(?:fs|shell):/.test(permission)));
});
