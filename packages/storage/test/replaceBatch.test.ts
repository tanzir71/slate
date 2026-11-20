import { afterEach, expect, it, vi } from "vitest";
import { createMemoryFiles } from "../src/browserFiles";
import { createFileSpace } from "../src/fileSpace";
import { encodeText } from "../src/fileIO";
import { prepareReplaceBatch } from "@slate/storage/replace-batch";
import type { LiteralSearchOptions } from "@slate/core";

const original = "\uFEFF# Alpha\r\n\r\nAlpha words kept.\rEnd\n";
afterEach(() => vi.restoreAllMocks());
async function setup(initial: Record<string, string | Uint8Array> = { "a.md": original, "b.md": "Alpha in Beta\n" }) {
  const files = createMemoryFiles();
  for (const [path, value] of Object.entries(initial)) await files.write(path, typeof value === "string" ? encodeText(value) : value);
  let owned = true;
  const canWrite = () => owned, space = createFileSpace(files, canWrite);
  const prepare = (paths = Object.keys(initial), replacement = "New", options: LiteralSearchOptions = {}) => prepareReplaceBatch({ space, paths, query: "Alpha", replacement, options, group: "replace-1", canWrite });
  return { files, space, prepare, canWrite, own: (next: boolean) => { owned = next; } };
}

it("reviews current bytes without writing and distinguishes unchanged, unmatched, unsupported and unavailable files", async () => {
  const { files, prepare } = await setup({ "a.md": original, "same.md": "alpha", "other.md": "Other", "bad.md": new Uint8Array([255, 254]) });
  const writes = vi.spyOn(files, "write");
  const batch = await prepare(["a.md", "same.md", "other.md", "bad.md", "missing.md", "a.md"], "alpha");
  expect(batch.rows().map(({ path, status }) => [path, status])).toEqual([["a.md", "ready"], ["same.md", "unchanged"], ["other.md", "unmatched"], ["bad.md", "unsupported"], ["missing.md", "unavailable"]]);
  expect(batch.rows()[0]).toMatchObject({ before: original, after: original.replaceAll("Alpha", "alpha"), matches: 2, replacements: 2 });
  expect(batch.rows()[1]).toMatchObject({ matches: 1, replacements: 0 });
  expect(writes).not.toHaveBeenCalled(); expect(batch.hasUndo()).toBe(false);
});
it("applies only selected preview rows, preserves original bytes and undoes once", async () => {
  const { files, prepare } = await setup(); const batch = await prepare();
  const exposed = batch.rows()[0]! as { before: string; after: string }; exposed.before = "forged"; exposed.after = "forged";
  await batch.apply(["a.md", "a.md"]);
  expect(await files.read("a.md")).toEqual(encodeText(original.replaceAll("Alpha", "New")));
  expect(await files.read("b.md")).toEqual(encodeText("Alpha in Beta\n"));
  expect(await files.read(batch.rows()[0]!.historyPath!)).toEqual(encodeText(original));
  expect(batch.hasUndo()).toBe(true); await batch.undo();
  expect(await files.read("a.md")).toEqual(encodeText(original)); expect(batch.hasUndo()).toBe(false);
  const writes = vi.spyOn(files, "write"); await batch.undo(); expect(writes).not.toHaveBeenCalled();
});
it("rejects a changed preview before creating history and stops the remaining selected rows", async () => {
  const { files, prepare } = await setup(); const batch = await prepare();
  await files.write("a.md", encodeText("External kept")); const writes = vi.spyOn(files, "write");
  await batch.apply(["a.md", "b.md"]);
  expect(batch.rows().map((row) => row.status)).toEqual(["conflict", "ready"]);
  expect(await files.read("a.md")).toEqual(encodeText("External kept")); expect(writes).not.toHaveBeenCalled();
});
it("keeps an external edit, the exact original and a recoverable proposal when disk changes after the backup", async () => {
  const { files, prepare } = await setup(); const batch = await prepare(); const write = files.write;
  vi.spyOn(files, "write").mockImplementation(async (path, bytes) => {
    await write(path, bytes); if (path.startsWith(".slate/history/")) await write("a.md", encodeText("External kept"));
  });
  await batch.apply(["a.md", "b.md"]); const row = batch.rows()[0]!;
  expect(row.status).toBe("conflict"); expect(await files.read("a.md")).toEqual(encodeText("External kept"));
  expect(await files.read(row.historyPath!)).toEqual(encodeText(original));
  expect(await files.read(row.recoveryPath!)).toEqual(encodeText(original.replaceAll("Alpha", "New")));
  expect(batch.rows()[1]!.status).toBe("ready"); expect(batch.hasUndo()).toBe(false);
});
it("retains a failed save for retry and reuses a verified original backup", async () => {
  const { files, prepare } = await setup(); const batch = await prepare(); const write = files.write;
  const blocked = vi.spyOn(files, "write").mockImplementation((path, bytes) => path === "a.md" ? Promise.reject(new Error("Disk full")) : write(path, bytes));
  await batch.apply(["a.md", "b.md"]); expect(batch.rows().map((row) => row.status)).toEqual(["failed", "ready"]);
  const history = batch.rows()[0]!.historyPath!; expect(await files.read(history)).toEqual(encodeText(original));
  blocked.mockRestore(); await batch.apply(["a.md", "b.md"]);
  expect(batch.rows().map((row) => row.status)).toEqual(["applied", "applied"]);
  expect(batch.rows()[0]!.historyPath).toBe(history);
  expect((await files.list(true)).filter((path) => path.startsWith(".slate/history/") && path.endsWith("a.md"))).toHaveLength(1);
});
it("does not mutate notes when preserving the original fails", async () => {
  const { files, prepare } = await setup(); const batch = await prepare(); const write = files.write;
  vi.spyOn(files, "write").mockImplementation((path, bytes) => path.startsWith(".slate/history/") ? Promise.reject(new Error("Backup denied")) : write(path, bytes));
  await batch.apply(["a.md", "b.md"]);
  expect(batch.rows()[0]).toMatchObject({ status: "failed", error: "Backup denied" });
  expect(await files.read("a.md")).toEqual(encodeText(original)); expect(batch.rows()[1]!.status).toBe("ready");
});
it("preserves newer words during Undo and can finish after the user restores the applied bytes", async () => {
  const { files, prepare } = await setup(); const batch = await prepare(); await batch.apply(["a.md", "b.md"]);
  await files.write("a.md", encodeText("Newer words")); await batch.undo();
  expect(batch.rows().map((row) => row.status)).toEqual(["undo-failed", "undone"]); expect(batch.hasUndo()).toBe(true);
  expect(await files.read("a.md")).toEqual(encodeText("Newer words"));
  await files.write("a.md", encodeText(original.replaceAll("Alpha", "New"))); await batch.undo();
  expect(await files.read("a.md")).toEqual(encodeText(original)); expect(batch.hasUndo()).toBe(false);
});
it("does not recreate a file deleted after replacement and accepts an already restored original", async () => {
  const { files, prepare } = await setup(); const batch = await prepare(); await batch.apply(["a.md"]);
  await files.remove("a.md"); await batch.undo();
  expect(batch.rows()[0]!.status).toBe("undo-failed"); expect(await files.read("a.md")).toBeUndefined();
  await files.write("a.md", encodeText(original)); const writes = vi.spyOn(files, "write"); await batch.undo();
  expect(batch.rows()[0]!.status).toBe("undone"); expect(writes).not.toHaveBeenCalled();
});
it("keeps a race during Undo in a conflict copy without overwriting the newer file", async () => {
  const { files, prepare } = await setup(); const batch = await prepare(); await batch.apply(["a.md"]);
  const read = files.read; let changed = false;
  vi.spyOn(files, "read").mockImplementation(async (path) => {
    const bytes = await read(path);
    if (path === "a.md" && !changed) { changed = true; await files.write(path, encodeText("External during Undo")); }
    return bytes;
  });
  await batch.undo(); expect(batch.rows()[0]!.status).toBe("undo-failed");
  expect(await read("a.md")).toEqual(encodeText("External during Undo"));
  const recovery = (await files.list()).find((path) => path.includes("conflicted copy"));
  expect(await read(recovery!)).toEqual(encodeText(original));
});
it("allows read-only previews but rejects Apply and Undo after ownership is lost", async () => {
  const { files, prepare, own } = await setup(); own(false); const batch = await prepare();
  const writes = vi.spyOn(files, "write"); await expect(batch.apply(["a.md"])).rejects.toThrow(/read-only/); expect(writes).not.toHaveBeenCalled();
  own(true); await batch.apply(["a.md"]); own(false); await expect(batch.undo()).rejects.toThrow(/read-only/);
  expect(await files.read("a.md")).toEqual(encodeText(original.replaceAll("Alpha", "New")));
});
it("rechecks ownership after saving a backup and keeps all notes untouched", async () => {
  const { files, prepare, own } = await setup(); const batch = await prepare(); const write = files.write;
  vi.spyOn(files, "write").mockImplementation(async (path, bytes) => { await write(path, bytes); if (path.startsWith(".slate/history/")) own(false); });
  await batch.apply(["a.md", "b.md"]); expect(batch.rows()[0]!.status).toBe("failed");
  expect(await files.read("a.md")).toEqual(encodeText(original)); expect(batch.rows()[1]!.status).toBe("ready");
});
it("serializes duplicate Apply and queued Undo without repeated writes", async () => {
  const { files, prepare } = await setup(); const batch = await prepare(["a.md"]);
  const write = vi.spyOn(files, "write"); await Promise.all([batch.apply(["a.md"]), batch.apply(["a.md"]), batch.undo()]);
  expect(await files.read("a.md")).toEqual(encodeText(original)); expect(batch.rows()[0]!.status).toBe("undone");
  expect(write.mock.calls.filter(([path]) => path === "a.md")).toHaveLength(2);
});
it("validates the entire path and selection set before reading or mutating files", async () => {
  const { files, space, canWrite, prepare } = await setup(); const read = vi.spyOn(files, "read");
  for (const path of ["../a.md", "C:/a.md", "/a.md", "a.txt", ".slate/history/a.md", "Notes/.SLATE/a.md", ".GIT/a.md"]) {
    await expect(prepare(["a.md", path])).rejects.toThrow();
  }
  await expect(prepareReplaceBatch({ space, paths: ["a.md"], query: "", replacement: "New", group: "ok", canWrite })).rejects.toThrow(/Enter text/);
  await expect(prepareReplaceBatch({ space, paths: ["a.md"], query: "Alpha", replacement: "New", group: "../bad", canWrite })).rejects.toThrow(/history group/);
  expect(read).not.toHaveBeenCalled(); const batch = await prepare(); const writes = vi.spyOn(files, "write");
  await expect(batch.apply(["a.md", "outside.md"])).rejects.toThrow(/preview/); expect(writes).not.toHaveBeenCalled();
});
it("does not write empty selections, no-op matches or replacement text that cannot round-trip UTF-8", async () => {
  const { files, prepare } = await setup({ "a.md": "Alpha" }); const writes = vi.spyOn(files, "write");
  const noop = await prepare(["a.md"], "Alpha"); await noop.apply(["a.md"]); await noop.undo();
  const ready = await prepare(); await ready.apply([]);
  const invalid = await prepare(["a.md"], "\uD83D"); expect(invalid.rows()[0]).toMatchObject({ status: "unavailable", error: expect.stringContaining("UTF-8") });
  await invalid.apply(["a.md"]); expect(writes).not.toHaveBeenCalled();
});
it("normalizes and deduplicates prepared paths and captures the case option", async () => {
  const { files, prepare } = await setup({ "Book/a.md": "alpha Alpha" });
  const options = { matchCase: true }; const pending = prepare(["Book\\a.md", "Book/a.md"], "New", options); options.matchCase = false;
  const batch = await pending; expect(batch.rows()).toHaveLength(1); expect(batch.rows()[0]!.matches).toBe(1);
  await batch.apply(["Book/a.md"]); expect(await files.read("Book/a.md")).toEqual(encodeText("alpha New"));
});
it("supports cancellation during review and reports ordinary read failures without mutation", async () => {
  const { files, space, canWrite, prepare } = await setup(); const writes = vi.spyOn(files, "write");
  const progress = vi.fn(() => { throw new DOMException("Cancelled", "AbortError"); });
  await expect(prepareReplaceBatch({ space, paths: ["a.md", "b.md"], query: "Alpha", replacement: "New", group: "cancel", canWrite, onProgress: progress })).rejects.toThrow("Cancelled");
  expect(progress).toHaveBeenCalledWith(1, 2); expect(writes).not.toHaveBeenCalled();
  const blocked = vi.spyOn(files, "read").mockRejectedValue("Read blocked");
  expect((await prepare()).rows()[0]).toMatchObject({ status: "unavailable", error: "Read blocked" });
  blocked.mockRejectedValue(new DOMException("Stopped", "AbortError")); await expect(prepare()).rejects.toThrow("Stopped");
});
