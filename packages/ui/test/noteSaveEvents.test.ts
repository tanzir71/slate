import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";

const record = { id: "save-events", name: "Writing", tier: "library" } as const;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
async function setup() {
  const files = createMemoryFiles({ "note.md": "Original\n" });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  return { files, store };
}

it("publishes captured canonical note saves separately from catalog/preference notifications", async () => {
  const { store, files } = await setup();
  const events = vi.fn();
  const catalog = vi.fn();
  store.subscribeNoteSaved(events);
  store.setOnSaved(catalog);
  await store.refresh();
  await store.togglePinned("note.md");
  store.notifySaved();
  expect(events).not.toHaveBeenCalled();
  store.edit("New words\n");
  expect(events).not.toHaveBeenCalled();
  await store.flush();
  expect(events).toHaveBeenCalledExactlyOnceWith({
    path: "note.md",
    source: "New words\n",
    origin: "input",
  });
  expect(new TextDecoder().decode(await files.read("note.md"))).toBe(
    "New words\n",
  );
  expect(catalog).toHaveBeenCalledTimes(3);
});

it("distinguishes Tidy, history, explicit saves and recovered text", async () => {
  const { store } = await setup();
  const events = vi.fn();
  store.subscribeNoteSaved(events);
  store.edit("Tidy output\n", undefined, "tidy");
  await store.flush();
  store.edit("Undo output\n", undefined, "history");
  await store.flush();
  await store.save();
  expect(events.mock.calls.map(([snapshot]) => snapshot.origin)).toEqual([
    "tidy",
    "history",
    "explicit-save",
  ]);
  const second = createWorkspaceStore(record, store.space.files);
  store.edit("Recovered words\n");
  await second.load();
  second.setOwned(true);
  second.subscribeNoteSaved(events);
  await second.flush();
  expect(events.mock.lastCall?.[0]).toMatchObject({
    source: "Recovered words\n",
    origin: "recovery",
  });
});

it("never calls note-save observers for a failed write or conflict copy", async () => {
  const { store, files } = await setup();
  const events = vi.fn();
  store.subscribeNoteSaved(events);
  store.edit("Kept local words\n");
  const write = files.write;
  files.write = async () => {
    throw new Error("Disk unavailable");
  };
  await expect(store.flush()).rejects.toThrow("Disk unavailable");
  expect(events).not.toHaveBeenCalled();
  files.write = write;
  await files.write("note.md", encodeText("External words\n"));
  await store.flush();
  expect(events).not.toHaveBeenCalled();
  expect(await store.space.read("note.md")).toBe("External words\n");
  expect(await store.space.read(store.api.getState().selectedPath)).toBe(
    "Kept local words\n",
  );
});

it("keeps observer failures from changing completed writes and supports unsubscribing", async () => {
  const { store } = await setup();
  const bad = vi.fn(() => {
    throw new Error("Post-save observer failed");
  });
  const events = vi.fn();
  const unsubscribe = store.subscribeNoteSaved(bad);
  store.subscribeNoteSaved(events);
  store.edit("Saved words\n");
  await store.flush();
  expect(store.api.getState().saveState).toBe("Saved");
  expect(events).toHaveBeenCalledTimes(1);
  unsubscribe();
  store.edit("More words\n");
  await store.flush();
  expect(bad).toHaveBeenCalledTimes(1);
  expect(events).toHaveBeenCalledTimes(2);
});

it("emits each captured save when newer typing arrives during an earlier write", async () => {
  const { store, files } = await setup();
  const write = files.write;
  let release: (() => void) | undefined;
  files.write = async (path, bytes) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    files.write = write;
    await write(path, bytes);
  };
  const events = vi.fn();
  store.subscribeNoteSaved(events);
  store.edit("First\n");
  const saving = store.flush();
  await vi.waitFor(() => expect(release).toBeDefined());
  store.edit("Second\n", undefined, "history");
  release!();
  await saving;
  expect(
    events.mock.calls.map(([snapshot]) => [snapshot.source, snapshot.origin]),
  ).toEqual([
    ["First\n", "input"],
    ["Second\n", "history"],
  ]);
  expect(await store.space.read("note.md")).toBe("Second\n");
});

it("explicit Save writes an unchanged current note but protects unsupported or read-only files", async () => {
  const { store, files } = await setup();
  const events = vi.fn();
  store.subscribeNoteSaved(events);
  await store.save();
  expect(events).toHaveBeenCalledExactlyOnceWith({
    path: "note.md",
    source: "Original\n",
    origin: "explicit-save",
  });
  store.setOwned(false);
  await store.save();
  expect(events).toHaveBeenCalledTimes(1);
  await files.write("note.md", new Uint8Array([0xff]));
  await store.refresh();
  store.setOwned(true);
  await store.save();
  expect(await files.read("note.md")).toEqual(new Uint8Array([0xff]));
  expect(events).toHaveBeenCalledTimes(1);
});
