import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createDocumentSession, appendDocumentText } from "@slate/editor";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { createEditorDocumentPool } from "../src/browser/editorDocumentPool";
import { createLaunchAppendSession } from "../src/browser/launchAppendSession";

const before = "\uFEFF# Kept\r\n\r\nOriginal words.\r\n", after = before + "\r\nNew\r\nwords.";
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup() {
  const files = createMemoryFiles({ "Kept.md": before, "Other.md": "Other words." });
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files);
  await store.load(); const pool = createEditorDocumentPool(store); pool.connect();
  return { files, store, pool };
}

it("uses a retained file session for exact save and one Undo, even after another note was selected", async () => {
  const { files, store, pool } = await setup();
  try {
    await store.select("Other.md");
    const request = createLaunchAppendSession(store, pool, "Kept.md", "New\nwords.");
    await request.apply(); await request.apply();
    expect(await files.read("Kept.md")).toEqual(encodeText(after));
    expect(await files.read("Other.md")).toEqual(encodeText("Other words."));
    expect(store.api.getState().selectedPath).toBe("Kept.md");
    const session = pool.get("Kept.md", createDocumentSession)!;
    expect(session.undo()).toBe(true); await store.flush();
    expect(await files.read("Kept.md")).toEqual(encodeText(before));
    expect(session.undo()).toBe(false);
  } finally { pool.dispose(); }
});

it("retries a failed save without duplicating the appended words", async () => {
  const { files, store, pool } = await setup();
  try {
    const request = createLaunchAppendSession(store, pool, "Kept.md", "New\nwords.");
    const flush = vi.spyOn(store, "flush").mockRejectedValueOnce(new Error("Disk unavailable"));
    await expect(request.apply()).rejects.toThrow("Disk unavailable");
    expect(request.hasApplied()).toBe(true);
    expect(await files.read("Kept.md")).toEqual(encodeText(before));
    expect(pool.get("Kept.md", createDocumentSession)!.snapshot().source).toBe(after);
    flush.mockRestore(); await request.apply();
    expect(await files.read("Kept.md")).toEqual(encodeText(after));
  } finally { pool.dispose(); }
});

it("retains an applied request when a subscriber fails and retries only its save", async () => {
  const { files, store, pool } = await setup();
  try {
    const session = pool.get("Kept.md", createDocumentSession)!, stop = session.subscribe(() => { throw new Error("View failed"); });
    const request = createLaunchAppendSession(store, pool, "Kept.md", "New\nwords.");
    await expect(request.apply()).rejects.toThrow("editor view could not update");
    expect(request.hasApplied()).toBe(true); stop(); await request.apply();
    expect(await files.read("Kept.md")).toEqual(encodeText(after));
    expect(session.undo()).toBe(true); await store.flush();
    expect(await files.read("Kept.md")).toEqual(encodeText(before));
  } finally { pool.dispose(); }
});

it("checks ownership before and after loading the editor runtime", async () => {
  const { files, store, pool } = await setup();
  try {
    const load = vi.fn(async () => { store.setOwned(false); return { createDocumentSession, appendDocumentText }; });
    const request = createLaunchAppendSession(store, pool, "Kept.md", "New", load);
    await expect(request.apply()).rejects.toThrow("read-only");
    expect(request.hasApplied()).toBe(false);
    expect(await files.read("Kept.md")).toEqual(encodeText(before));
    load.mockClear(); await expect(request.apply()).rejects.toThrow("read-only");
    expect(load).not.toHaveBeenCalled();
  } finally { pool.dispose(); }
});

it("reads fresh disk words at confirmation and deduplicates concurrent confirmations", async () => {
  const { files, store, pool } = await setup();
  try {
    pool.get("Kept.md", createDocumentSession);
    const request = createLaunchAppendSession(store, pool, "Kept.md", "New\nwords.");
    await files.write("Kept.md", encodeText("Updated externally.\r\n"));
    const first = request.apply(), second = request.apply();
    expect(second).toBe(first); await first;
    expect(await files.read("Kept.md")).toEqual(encodeText("Updated externally.\r\n\r\nNew\r\nwords."));
    const session = pool.get("Kept.md", createDocumentSession)!;
    expect(session.undo()).toBe(true); await store.flush();
    expect(await files.read("Kept.md")).toEqual(encodeText("Updated externally.\r\n"));
  } finally { pool.dispose(); }
});
