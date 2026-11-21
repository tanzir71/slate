import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
test("desktop chrome retains macOS traffic lights and the shared native window constraints", async () => {
  const base = await read("../../apps/desktop/src-tauri/tauri.conf.json");
  const mac = await read("../../apps/desktop/src-tauri/tauri.macos.conf.json");
  assert.equal(base.app.windows[0].decorations, false);
  assert.equal(mac.app.windows[0].decorations, true);
  assert.equal(mac.app.windows[0].titleBarStyle, "Overlay");
  assert.equal(mac.app.windows[0].hiddenTitle, true);
  assert.deepEqual(mac.app.windows[0].trafficLightPosition, { x: 12, y: 12 });
  for (const key of ["title", "width", "height", "minWidth", "minHeight"])
    assert.equal(mac.app.windows[0][key], base.app.windows[0][key], key);
});

test("native window controls have explicit permissions in the local main window only", async () => {
  const capability = await read("../../apps/desktop/src-tauri/capabilities/default.json");
  assert.deepEqual(capability.windows, ["main"]);
  assert.equal(capability.local, true);
  assert.equal(capability.remote, undefined);
  for (const permission of ["close", "destroy", "minimize", "toggle-maximize", "start-dragging"])
    assert.ok(capability.permissions.includes(`core:window:allow-${permission}`), permission);
});

test("the generated capability manifest exactly matches the native permission source", async () => {
  const capability = await read("../../apps/desktop/src-tauri/capabilities/default.json");
  delete capability.$schema;
  const generated = await read("../../apps/desktop/src-tauri/gen/schemas/capabilities.json");
  assert.deepEqual(generated.default, capability);
});
