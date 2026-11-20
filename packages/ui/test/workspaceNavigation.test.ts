import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { createWorkspaceNavigation } from "../src/browser/workspaceNavigation";

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup() {
  const files = createMemoryFiles({ "a.md": "\uFEFFAlpha\r\n", "b.md": "Beta", "c.md": "Gamma" });
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files);
  await store.load();
  const navigation = createWorkspaceNavigation(store), disconnect = navigation.connect();
  return { files, store, navigation, disconnect };
}

it("tracks actual selections, deduplicates revisits and truncates forward visits after branching", async () => {
  const { store, navigation } = await setup();
  expect(navigation.getSnapshot()).toEqual({ canBack: false, canForward: false, busy: false });
  await store.select("b.md"); await store.select("b.md"); await store.select("c.md");
  await navigation.go(-1); expect(store.api.getState().selectedPath).toBe("b.md");
  expect(navigation.getSnapshot().canForward).toBe(true);
  await navigation.go(-1); expect(store.api.getState().selectedPath).toBe("a.md");
  expect(navigation.getSnapshot().canBack).toBe(false);
  await navigation.go(1); expect(store.api.getState().selectedPath).toBe("b.md");
  await store.select("a.md");
  expect(navigation.getSnapshot().canForward).toBe(false);
  await navigation.go(-1); expect(store.api.getState().selectedPath).toBe("b.md");
});
it("saves current drafts and opens current external bytes without rewriting the destination", async () => {
  const { files, store, navigation } = await setup();
  await store.select("b.md"); store.edit("Beta draft");
  const external = encodeText("\uFEFFExternal\r\n"); await files.write("a.md", external);
  await navigation.go(-1);
  expect(await files.read("a.md")).toEqual(external);
  expect(await files.read("b.md")).toEqual(encodeText("Beta draft"));
  expect(store.api.getState().sheets.find((sheet) => sheet.path === "a.md")?.content).toBe("\uFEFFExternal\r\n");
});
it("skips deleted history entries and isolates each Space and disconnected session", async () => {
  const { files, store, navigation, disconnect } = await setup();
  await store.select("b.md"); await store.select("c.md");
  await files.remove("b.md"); await store.refresh();
  await navigation.go(-1); expect(store.api.getState().selectedPath).toBe("a.md");
  expect(navigation.getSnapshot().canBack).toBe(false);
  const other = await setup(); expect(other.navigation.getSnapshot().canBack).toBe(false);
  disconnect(); const snapshot = navigation.getSnapshot();
  await store.select("c.md"); expect(navigation.getSnapshot()).toBe(snapshot);
});
it("keeps visits and drafts in place when saving fails, allowing a later user action", async () => {
  const { files, store, navigation } = await setup();
  await store.select("b.md"); store.edit("Kept draft");
  const write = vi.spyOn(files, "write").mockRejectedValue(new Error("Disk unavailable"));
  await expect(navigation.go(-1)).rejects.toThrow("Disk unavailable");
  expect(store.api.getState().selectedPath).toBe("b.md");
  expect(navigation.getSnapshot()).toEqual({ canBack: true, canForward: false, busy: false });
  write.mockRestore(); await navigation.go(-1);
  expect(await files.read("b.md")).toEqual(encodeText("Kept draft"));
  expect(store.api.getState().selectedPath).toBe("a.md");
});
it("retains new typing during a destination read and ignores duplicate in-flight requests", async () => {
  const { files, store, navigation } = await setup(); await store.select("b.md");
  const read = files.read;
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const reads = vi.spyOn(files, "read").mockImplementation(async (path) => {
    if (path === "a.md") { started(); await pending; } return read(path);
  });
  const opening = navigation.go(-1); await entered;
  expect(navigation.getSnapshot().busy).toBe(true); await navigation.go(-1);
  store.edit("New words kept"); release(); await expect(opening).rejects.toThrow(/changed/);
  expect(reads.mock.calls.filter(([path]) => path === "a.md")).toHaveLength(1);
  expect(store.api.getState().selectedPath).toBe("b.md");
  await store.flush(); expect(await files.read("b.md")).toEqual(encodeText("New words kept"));
});
it("does not let an older read overtake later visits that return to the same current sheet", async () => {
  const { files, store, navigation } = await setup(); await store.select("b.md");
  const read = files.read;
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  vi.spyOn(files, "read").mockImplementation(async (path) => {
    if (path === "a.md") { started(); await pending; } return read(path);
  });
  const opening = navigation.go(-1); await entered;
  await store.select("c.md"); await store.select("b.md"); release();
  await expect(opening).rejects.toThrow(/changed/);
  expect(store.api.getState().selectedPath).toBe("b.md");
  await navigation.go(-1); expect(store.api.getState().selectedPath).toBe("c.md");
});
it("does no workspace scan or notification for a content-only edit", async () => {
  const { store, navigation } = await setup(); await store.select("b.md");
  const snapshot = navigation.getSnapshot(), listener = vi.fn(); navigation.subscribe(listener);
  const sheets = store.api.getState().sheets.map((sheet) => ({ ...sheet, content: "Changed" }));
  const scan = vi.spyOn(sheets, "map");
  store.api.setState({ sheets, saveState: "Unsaved" });
  expect(scan).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled();
  store.edit("Changed again"); expect(listener).not.toHaveBeenCalled();
  expect(navigation.getSnapshot()).toBe(snapshot);
});
it("retains the current visit after a failed read and opens unsupported bytes read-only", async () => {
  const { files, store, navigation } = await setup(); await store.select("b.md");
  const read = files.read;
  const blocked = vi.spyOn(files, "read").mockImplementation((path) => path === "a.md" ? Promise.reject(new Error("Permission lost")) : read(path));
  await expect(navigation.go(-1)).rejects.toThrow("Permission lost");
  expect(store.api.getState().selectedPath).toBe("b.md"); expect(navigation.getSnapshot().canBack).toBe(true);
  blocked.mockRestore(); const bytes = new Uint8Array([0xff, 0xfe, 0xfd]); await files.write("a.md", bytes);
  store.setOwned(false); await navigation.go(-1);
  expect(store.api.getState().selectedPath).toBe("a.md");
  expect(store.api.getState().sheets.find((sheet) => sheet.path === "a.md")?.unsupportedEncoding).toBe(true);
  expect(await files.read("a.md")).toEqual(bytes);
});
it("keeps at most one hundred visits and handles both empty and single-sheet Spaces", async () => {
  const { store, navigation } = await setup();
  for (let index = 0; index < 104; index++) await store.select(index % 2 ? "a.md" : "b.md");
  for (let index = 0; index < 99; index++) { expect(navigation.getSnapshot().canBack).toBe(true); await navigation.go(-1); }
  expect(navigation.getSnapshot().canBack).toBe(false);
  const files = createMemoryFiles(), empty = createWorkspaceStore({ id: "sample", name: "Empty", tier: "library" }, files);
  await empty.load(); const visits = createWorkspaceNavigation(empty); visits.connect();
  await visits.go(-1); await visits.go(1); expect(visits.getSnapshot().canBack).toBe(false);
  await files.write("only.md", encodeText("Only")); await empty.refresh();
  expect(visits.getSnapshot()).toEqual({ canBack: false, canForward: false, busy: false });
});
