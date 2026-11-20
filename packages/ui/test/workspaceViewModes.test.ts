import { afterEach, expect, it, vi } from "vitest";
import { createMemoryFiles } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { createWorkspaceViewModes } from "../src/browser/workspaceViewModes";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
async function fixture(id = "sample") {
  const files = createMemoryFiles({ "a.md": "Alpha\r\n", "b.md": "Beta\n" });
  const store = createWorkspaceStore({ id, name: "Notes", tier: "library" }, files);
  await store.load(); return { store, files };
}
it("reads only the requested sheet and isolates Spaces, including unusual paths", async () => {
  const { store } = await fixture(), read = vi.spyOn(Storage.prototype, "getItem"), modes = createWorkspaceViewModes(store);
  expect(read).not.toHaveBeenCalled(); expect(modes.mode("a.md")).toBe("live"); expect(read).toHaveBeenCalledTimes(1);
  modes.mode("a.md"); expect(read).toHaveBeenCalledTimes(1);
  modes.set("a.md", "source"); modes.set("b.md", "read");
  const reopened = createWorkspaceViewModes(store); expect(reopened.mode("a.md")).toBe("source"); expect(reopened.mode("b.md")).toBe("read");
  const other = await fixture("other"); expect(createWorkspaceViewModes(other.store).mode("a.md")).toBe("live");
  store.api.setState({ sheets: [{ path: "Work/a.b #% 日.md", content: "kept" }] });
  modes.set("Work/a.b #% 日.md", "source"); expect(createWorkspaceViewModes(store).mode("Work/a.b #% 日.md")).toBe("source");
});
it("falls back for malformed or blocked storage and retains choices in memory", async () => {
  const { store } = await fixture(); localStorage.setItem("slate.view-mode.sample.a.md", "{broken");
  expect(createWorkspaceViewModes(store).mode("a.md")).toBe("live");
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("blocked"); } };
  const modes = createWorkspaceViewModes(store, blocked), changed = vi.fn(); modes.subscribe(changed);
  modes.set("a.md", "read"); expect(modes.mode("a.md")).toBe("read"); expect(changed).toHaveBeenCalledTimes(1);
  modes.set("a.md", "read"); modes.set("missing.md", "source"); expect(changed).toHaveBeenCalledTimes(1);
});
it("transfers the preference only after a successful internal file move", async () => {
  const { store, files } = await fixture(), modes = createWorkspaceViewModes(store), stop = modes.connect();
  try {
    modes.set("a.md", "source"); modes.set("b.md", "read");
    await expect(store.move("a.md", "b.md")).rejects.toThrow();
    expect(modes.mode("a.md")).toBe("source"); expect(modes.mode("b.md")).toBe("read");
    await store.move("a.md", "Work/renamed.md");
    expect(modes.mode("Work/renamed.md")).toBe("source"); expect(modes.mode("a.md")).toBe("live");
    expect(createWorkspaceViewModes(store).mode("Work/renamed.md")).toBe("source");
    expect(await files.read("Work/renamed.md")).toEqual(new TextEncoder().encode("Alpha\r\n"));
  } finally { stop(); }
});
it("invalidates device choices from another tab and disconnects cleanly", async () => {
  const { store } = await fixture(), modes = createWorkspaceViewModes(store), stop = modes.connect(), changed = vi.fn(); modes.subscribe(changed);
  expect(modes.mode("a.md")).toBe("live"); localStorage.setItem("slate.view-mode.sample.a.md", "read");
  window.dispatchEvent(new StorageEvent("storage", { key: "slate.view-mode.other.a.md", storageArea: localStorage }));
  expect(changed).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent("storage", { key: "slate.view-mode.sample.a.md", storageArea: localStorage }));
  expect(modes.mode("a.md")).toBe("read"); expect(changed).toHaveBeenCalledTimes(1);
  stop(); localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
  expect(changed).toHaveBeenCalledTimes(1);
});
