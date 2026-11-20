import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";

const original = "\uFEFF# Alpha\r\n\r\nWords kept.\r\n";
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function setup(initial: Record<string, string> = { "a.md": original, "b.md": "Beta\n" }) {
  const files = createMemoryFiles(initial);
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files);
  await store.load(); return { files, store };
}

it("keeps an unchanged workspace snapshot without skipping any disk reads", async () => {
  const { files, store } = await setup(), snapshot = store.api.getState();
  const read = vi.spyOn(files, "read"), changed = vi.fn(); store.api.subscribe(changed);
  await store.refresh(); await store.refresh();
  expect(read.mock.calls.map(([path]) => path).sort()).toEqual(["a.md", "a.md", "b.md", "b.md"]);
  expect(store.api.getState()).toBe(snapshot); expect(changed).not.toHaveBeenCalled();
});

it("publishes one external source change while retaining every unchanged sheet reference", async () => {
  const { files, store } = await setup(), before = store.api.getState(), changed = vi.fn();
  store.api.subscribe(changed); await files.write("b.md", encodeText("New Beta words\n")); await store.refresh();
  const after = store.api.getState();
  expect(changed).toHaveBeenCalledTimes(1); expect(after).not.toBe(before);
  expect(after.sheets[0]).toBe(before.sheets[0]); expect(after.sheets[1]).not.toBe(before.sheets[1]);
  expect(before.sheets[1]?.content).toBe("Beta\n"); expect(after.sheets[1]?.content).toBe("New Beta words\n");
});

it("publishes real membership and selection changes, then becomes stable again", async () => {
  const { files, store } = await setup(); await store.select("b.md");
  const alpha = store.api.getState().sheets[0], changed = vi.fn(); store.api.subscribe(changed);
  await files.remove("b.md"); await files.write("0.md", encodeText("Gamma")); await store.refresh();
  const snapshot = store.api.getState();
  expect(snapshot.selectedPath).toBe("0.md"); expect(snapshot.sheets.map((sheet) => sheet.path)).toEqual(["0.md", "a.md"]);
  expect(snapshot.sheets[1]).toBe(alpha); expect(changed).toHaveBeenCalledTimes(1);
  await store.refresh(); expect(store.api.getState()).toBe(snapshot); expect(changed).toHaveBeenCalledTimes(1);
});

it("notifies an encoding change even when both decoded contents are empty", async () => {
  const { files, store } = await setup(); await files.write("bad.md", new Uint8Array([0xff])); await store.refresh();
  const before = store.api.getState(), changed = vi.fn(); store.api.subscribe(changed);
  expect(before.sheets.find((sheet) => sheet.path === "bad.md")).toMatchObject({ content: "", unsupportedEncoding: true });
  await files.write("bad.md", new Uint8Array()); await store.refresh();
  const supported = store.api.getState();
  expect(supported.sheets[0]).toBe(before.sheets[0]);
  expect(supported.sheets.find((sheet) => sheet.path === "bad.md")?.unsupportedEncoding).toBeUndefined();
  expect(changed).toHaveBeenCalledTimes(1);
  await files.write("bad.md", new Uint8Array([0xff])); await store.refresh();
  expect(store.api.getState().sheets.find((sheet) => sheet.path === "bad.md")?.unsupportedEncoding).toBe(true);
  expect(changed).toHaveBeenCalledTimes(2);
});

it("keeps visible drafts stable and retains their original conflict base across disk refreshes", async () => {
  const { files, store } = await setup(); store.editSheet("a.md", "My Alpha draft");
  const snapshot = store.api.getState(), changed = vi.fn(); store.api.subscribe(changed);
  await store.refresh(); await files.write("a.md", encodeText("External Alpha words")); await store.refresh();
  expect(store.api.getState()).toBe(snapshot); expect(changed).not.toHaveBeenCalled();
  await store.flush();
  expect(await files.read("a.md")).toEqual(encodeText("External Alpha words"));
  expect(await files.read("b.md")).toEqual(encodeText("Beta\n"));
  expect((await store.space.sheets()).filter((sheet) => !["a.md", "b.md"].includes(sheet.path)).map((sheet) => sheet.content)).toEqual(["My Alpha draft"]);
});

it("uses edits and selection made during an outstanding disk read", async () => {
  const { files, store } = await setup(), read = files.read;
  let release: (() => void) | undefined, started: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reading = new Promise<void>((resolve) => { started = resolve; });
  vi.spyOn(files, "read").mockImplementation(async (path) => {
    const bytes = await read(path);
    if (path === "a.md") { started!(); await gate; }
    return bytes;
  });
  const refresh = store.refresh(); await reading;
  store.editSheet("a.md", "Typed while reading disk"); store.api.setState({ selectedPath: "b.md" });
  const snapshot = store.api.getState(), changed = vi.fn(); store.api.subscribe(changed);
  release!(); await refresh;
  expect(store.api.getState()).toBe(snapshot); expect(changed).not.toHaveBeenCalled();
  expect(store.api.getState().selectedPath).toBe("b.md");
  expect(store.api.getState().sheets.find((sheet) => sheet.path === "a.md")?.content).toBe("Typed while reading disk");
});

it("does not publish repeated empty refreshes", async () => {
  const { store } = await setup({}), snapshot = store.api.getState(), changed = vi.fn();
  store.api.subscribe(changed); await store.refresh(); await store.refresh();
  expect(store.api.getState()).toBe(snapshot); expect(changed).not.toHaveBeenCalled();
});
