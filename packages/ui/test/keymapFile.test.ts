import { expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import {
  keymapPath,
  loadKeymapFile,
  saveKeymapFile,
} from "../src/browser/keymapFile";

const record = {
  id: "keymap-library",
  name: "Writing",
  tier: "library",
} as const;
const profile = { os: "windows", surface: "web" } as const;
const proposal = '{"version":1,"bindings":{"sheet.new":"Alt+m"}}\n';
function setup(source?: string) {
  const files = createMemoryFiles(
    source === undefined ? {} : { [keymapPath]: source },
  );
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  return { files, store };
}
it("creates a missing Space keymap and saves an exact UTF-8 BOM/CRLF proposal", async () => {
  const { files, store } = setup();
  const base = await loadKeymapFile(store);
  expect(base.bytes).toBeUndefined();
  const source = "\ufeff" + proposal.replaceAll("\n", "\r\n");
  expect(await saveKeymapFile(store, base, source, profile)).toMatchObject({
    path: keymapPath,
    conflict: false,
  });
  expect(await files.read(keymapPath)).toEqual(encodeText(source));
});
it("keeps an external edit intact and saves the reviewed proposal as a conflict copy", async () => {
  const { files, store } = setup('{"version":1,"bindings":{}}');
  const base = await loadKeymapFile(store);
  const external = '\ufeff{"version":1,"bindings":{"sheet.new":"Alt+y"}}\r\n';
  await files.write(keymapPath, encodeText(external));
  const result = await saveKeymapFile(store, base, proposal, profile);
  expect(result.conflict).toBe(true);
  expect(result.path).not.toBe(keymapPath);
  expect(await files.read(keymapPath)).toEqual(encodeText(external));
  expect(await files.read(result.path)).toEqual(encodeText(proposal));
});
it("rejects conflicts, AltGr, browser reservations, read-only changes and unacknowledged unreadable bytes", async () => {
  const { files, store } = setup();
  const base = await loadKeymapFile(store);
  for (const bindings of [
    { "format.bold": "Mod+i" },
    { "format.bold": "Ctrl+Alt+b" },
    { "sheet.new": "Mod+n" },
  ])
    await expect(
      saveKeymapFile(
        store,
        base,
        JSON.stringify({ version: 1, bindings }),
        profile,
      ),
    ).rejects.toThrow();
  expect(await files.list(true)).toEqual([]);
  store.setOwned(false);
  await expect(saveKeymapFile(store, base, proposal, profile)).rejects.toThrow(
    "read-only",
  );
  store.setOwned(true);
  await files.write(keymapPath, new Uint8Array([0xff, 0xfe]));
  const invalid = await loadKeymapFile(store);
  expect(invalid.readable).toBe(false);
  await expect(
    saveKeymapFile(store, invalid, proposal, profile),
  ).rejects.toThrow("before saving");
  expect(await files.read(keymapPath)).toEqual(new Uint8Array([0xff, 0xfe]));
  expect(
    await saveKeymapFile(
      store,
      { ...invalid, readable: true },
      proposal,
      profile,
    ),
  ).toMatchObject({ conflict: false });
  expect(await files.read(keymapPath)).toEqual(encodeText(proposal));
});
it("propagates read failure instead of treating an inaccessible keymap as missing", async () => {
  const { files, store } = setup();
  vi.spyOn(files, "read").mockRejectedValueOnce(new Error("Access denied"));
  await expect(loadKeymapFile(store)).rejects.toThrow("Access denied");
  expect(await files.list(true)).toEqual([]);
});
