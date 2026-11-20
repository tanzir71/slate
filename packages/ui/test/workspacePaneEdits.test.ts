import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";

const original = "\uFEFF# Alpha\r\n\r\nWords kept.\r\n";
const record = { id: "pane-edits", name: "Notes", tier: "library" } as const;
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function setup() {
  const files = createMemoryFiles({ "a.md": original, "b.md": "Beta\n" });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true); await store.load();
  return { files, store };
}

it("keeps a captured editor's writes on its own path after another pane becomes selected", async () => {
  const { files, store } = await setup();
  const editAlpha = (content: string) => store.editSheet("a.md", content);
  await store.select("b.md");
  const changed = original.replace("Words", "Alpha's words");
  expect(editAlpha(changed)).toBe(true);
  store.edit("Beta's words\n");
  expect(store.api.getState().selectedPath).toBe("b.md");
  expect(store.api.getState().saveState).toBe("Unsaved");
  await store.flush();
  expect(await files.read("a.md")).toEqual(encodeText(changed));
  expect(await files.read("b.md")).toEqual(encodeText("Beta's words\n"));
});

it("autosaves nonselected edits with their actual save snapshot identity", async () => {
  const { files, store } = await setup(); const saved = vi.fn();
  store.subscribeNoteSaved(saved); await store.select("b.md");
  store.editSheet("a.md", "Alpha from the other pane", undefined, "history");
  await vi.advanceTimersByTimeAsync(250);
  expect(await files.read("a.md")).toEqual(encodeText("Alpha from the other pane"));
  expect(await files.read("b.md")).toEqual(encodeText("Beta\n"));
  expect(saved).toHaveBeenCalledWith({ path: "a.md", source: "Alpha from the other pane", origin: "history" });
  expect(store.api.getState()).toMatchObject({ selectedPath: "b.md", saveState: "Saved" });
});

it("recovers compact changes under the captured path while keeping the other file untouched", async () => {
  const { files, store } = await setup(); await store.select("b.md");
  const normalized = original.replaceAll("\r\n", "\n"), position = normalized.indexOf("Words") + 5;
  const changed = normalized.slice(0, position) + "!" + normalized.slice(position);
  store.editSheet("a.md", changed, [{ from: position, to: position, text: "!" }]);
  expect(await files.read("a.md")).toEqual(encodeText(original));
  const reopened = createWorkspaceStore(record, files); reopened.setOwned(true); await reopened.load();
  expect(reopened.api.getState().sheets.find((sheet) => sheet.path === "a.md")?.content).toBe(changed);
  await reopened.flush();
  expect(await files.read("a.md")).toEqual(encodeText(changed));
  expect(await files.read("b.md")).toEqual(encodeText("Beta\n"));
});

it("preserves a nonselected file's external edits and the pane's draft in separate files", async () => {
  const { files, store } = await setup(); await store.select("b.md");
  store.editSheet("a.md", "Words from the Alpha pane");
  await files.write("a.md", encodeText("External Alpha words"));
  await store.flush();
  expect(await files.read("a.md")).toEqual(encodeText("External Alpha words"));
  expect(await files.read("b.md")).toEqual(encodeText("Beta\n"));
  const copies = (await store.space.sheets()).filter((sheet) => sheet.path !== "a.md" && sheet.path !== "b.md");
  expect(copies).toHaveLength(1); expect(copies[0]?.content).toBe("Words from the Alpha pane");
  expect(store.api.getState().selectedPath).toBe("b.md");
});

it("refuses missing, unsupported and unowned pane targets without queuing a write", async () => {
  const { files, store } = await setup();
  const unsupported = new Uint8Array([0xff, 0xfe, 0xfd]); await files.write("bad.md", unsupported); await store.refresh();
  for (const path of ["missing.md", "../a.md", "bad.md"]) expect(store.editSheet(path, "Must not be saved")).toBe(false);
  await store.select("bad.md"); store.edit("Keep the original encoding");
  store.setOwned(false); expect(store.editSheet("a.md", "Not owned")).toBe(false);
  await vi.advanceTimersByTimeAsync(250); await store.flush();
  expect(await files.read("a.md")).toEqual(encodeText(original));
  expect(await files.read("b.md")).toEqual(encodeText("Beta\n"));
  expect(await files.read("bad.md")).toEqual(unsupported);
  expect(await files.read("missing.md")).toBeUndefined();
});
