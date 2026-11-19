import { expect, it, vi } from "vitest";
import { fix, type TidyConfiguration } from "@slate/core/tidy";
import { createMemoryFiles, encodeText } from "../src/browserFiles";
import { createFileSpace } from "../src/fileSpace";
import { prepareTidyBatch } from "../src/tidyBatch";

const dirty = (title: string) => `  #   ${title}\n\nWords kept\n`;
const clean = (title: string) => `# ${title}\n\nWords kept\n`;
async function setup(initial: Record<string, string | Uint8Array> = { "one.md": dirty("One"), "two.md": dirty("Two") }) {
  const files = createMemoryFiles();
  for (const [path, value] of Object.entries(initial)) await files.write(path, typeof value === "string" ? encodeText(value) : value);
  let owned = true;
  const space = createFileSpace(files, () => owned);
  const analyze = vi.fn(async (source: string, configuration: TidyConfiguration) => fix(source, configuration));
  const prepare = (paths = Object.keys(initial), group = "batch-1") => prepareTidyBatch({ space, paths, group, fix: analyze, canWrite: () => owned });
  return { files, space, prepare, analyze, own: (next: boolean) => { owned = next; } };
}

it("reviews exact source without writing and separates clean, unsupported and unavailable files", async () => {
  const bom = "\uFEFF  #   One\r\n\r\nWords kept\r\n";
  const { files, prepare, analyze } = await setup({ "one.md": bom, "clean.md": "Plain words\n", "legacy.md": new Uint8Array([0xff, 0xfe, 65, 0]) });
  const writes = vi.spyOn(files, "write");
  const batch = await prepare(["one.md", "clean.md", "legacy.md", "missing.md", "one.md"]);
  expect(batch.rows().map(({ path, status }) => [path, status])).toEqual([["one.md", "ready"], ["clean.md", "unchanged"], ["legacy.md", "unsupported"], ["missing.md", "unavailable"]]);
  expect(batch.rows()[0]).toMatchObject({ before: bom, after: bom.replace("  #   ", "# "), fixes: 2 });
  expect(analyze).toHaveBeenCalledTimes(2);
  expect(writes).not.toHaveBeenCalled();
  expect(batch.hasUndo()).toBe(false);
});

it("applies only chosen files, keeps original bytes in history, and undoes the batch once", async () => {
  const original = "\uFEFF  #   One\r\n\r\nWords kept\r\n";
  const { files, prepare, space } = await setup({ "one.md": original, "two.md": dirty("Two") });
  const batch = await prepare();
  const exposed = batch.rows()[0]! as { before: string; after: string };
  exposed.before = "Forged source"; exposed.after = "Forged output";
  await batch.apply(["one.md"]);
  expect(await space.read("one.md")).toBe(original.replace("  #   ", "# "));
  expect(await space.read("two.md")).toBe(dirty("Two"));
  expect(await files.read(batch.rows()[0]!.historyPath!)).toEqual(encodeText(original));
  expect(batch.hasUndo()).toBe(true);
  await batch.undo();
  expect(await files.read("one.md")).toEqual(encodeText(original));
  expect(batch.hasUndo()).toBe(false);
  const writes = vi.spyOn(files, "write");
  await batch.undo();
  expect(writes).not.toHaveBeenCalled();
});

it("refuses a changed source before creating history or saving a proposal", async () => {
  const { files, prepare, space } = await setup();
  const batch = await prepare();
  await files.write("one.md", encodeText("External words\n"));
  const writes = vi.spyOn(files, "write");
  await batch.apply(["one.md", "two.md"]);
  expect(batch.rows()[0]).toMatchObject({ status: "conflict" });
  expect(await space.read("one.md")).toBe("External words\n");
  expect(await space.read("two.md")).toBe(dirty("Two"));
  expect(writes).not.toHaveBeenCalled();
});

it("keeps an external edit and a recoverable proposal when the source changes after history is saved", async () => {
  const { files, prepare, space } = await setup();
  const batch = await prepare();
  const write = files.write;
  vi.spyOn(files, "write").mockImplementation(async (path, bytes) => {
    await write(path, bytes);
    if (path.startsWith(".slate/history/")) await write("one.md", encodeText("External during apply\n"));
  });
  await batch.apply(["one.md", "two.md"]);
  const row = batch.rows()[0]!;
  expect(row.status).toBe("conflict");
  expect(await space.read("one.md")).toBe("External during apply\n");
  expect(await space.read(row.recoveryPath!)).toBe(clean("One"));
  expect(await files.read(row.historyPath!)).toEqual(encodeText(dirty("One")));
  expect(await space.read("two.md")).toBe(dirty("Two"));
});

it("retries only unfinished files and reuses exact history after a partial write failure", async () => {
  const { files, prepare, space } = await setup({ "one.md": dirty("One"), "two.md": dirty("Two"), "three.md": dirty("Three") });
  const batch = await prepare();
  const write = files.write;
  let denied = true;
  const writes = vi.spyOn(files, "write").mockImplementation(async (path, bytes) => {
    if (path === "two.md" && denied) throw new Error("Permission denied");
    await write(path, bytes);
  });
  await batch.apply(["one.md", "two.md", "three.md"]);
  expect(batch.rows().map(({ status }) => status)).toEqual(["applied", "failed", "ready"]);
  expect(await space.read("three.md")).toBe(dirty("Three"));
  denied = false;
  await batch.apply(["one.md", "two.md", "three.md"]);
  expect(batch.rows().map(({ status }) => status)).toEqual(["applied", "applied", "applied"]);
  expect(writes.mock.calls.filter(([path]) => path === "one.md")).toHaveLength(1);
  expect(writes.mock.calls.filter(([path]) => path.startsWith(".slate/history/")).map(([path]) => path)).toEqual([".slate/history/batch-1/one.md", ".slate/history/batch-1/two.md", ".slate/history/batch-1/three.md"]);
  await batch.undo();
  expect(await space.read("one.md")).toBe(dirty("One"));
  expect(await space.read("two.md")).toBe(dirty("Two"));
  expect(await space.read("three.md")).toBe(dirty("Three"));
});

it("does not change source when history cannot be written or write ownership is lost during history creation", async () => {
  const { files, prepare, own, space } = await setup();
  const batch = await prepare();
  const write = files.write;
  const spy = vi.spyOn(files, "write").mockRejectedValueOnce(new Error("History storage full"));
  await batch.apply(["one.md"]);
  expect(batch.rows()[0]).toMatchObject({ status: "failed", error: "History storage full" });
  expect(await space.read("one.md")).toBe(dirty("One"));
  spy.mockImplementation(async (path, bytes) => { await write(path, bytes); if (path.startsWith(".slate/history/")) own(false); });
  await batch.apply(["one.md"]);
  expect(await space.read("one.md")).toBe(dirty("One"));
  expect(batch.rows()[0]!.error).toContain("read-only");
});

it("allows read-only review but refuses applying or undoing without current ownership", async () => {
  const { files, prepare, own } = await setup();
  own(false);
  const batch = await prepare();
  const writes = vi.spyOn(files, "write");
  await expect(batch.apply(["one.md"])).rejects.toThrow("read-only");
  expect(writes).not.toHaveBeenCalled();
  own(true); await batch.apply(["one.md"]); own(false);
  await expect(batch.undo()).rejects.toThrow("read-only");
  expect(batch.hasUndo()).toBe(true);
});

it("binds review to the exact settings file and refuses malformed settings", async () => {
  const { files, prepare } = await setup();
  const batch = await prepare();
  await files.write(".slate/tidy.json", encodeText('{"version":1,"preset":"minimal"}\n'));
  const writes = vi.spyOn(files, "write");
  await expect(batch.apply(["one.md"])).rejects.toThrow("rules changed");
  expect(writes).not.toHaveBeenCalled();
  await files.write(".slate/tidy.json", encodeText("{broken"));
  await expect(prepare()).rejects.toThrow();
});

it("rechecks the rules after a slow history write before changing the canonical note", async () => {
  const { files, prepare, space } = await setup();
  const batch = await prepare();
  const write = files.write;
  vi.spyOn(files, "write").mockImplementation(async (path, bytes) => {
    await write(path, bytes);
    if (path.startsWith(".slate/history/")) await write(".slate/tidy.json", encodeText('{"version":1,"preset":"minimal"}\n'));
  });
  await batch.apply(["one.md"]);
  expect(await space.read("one.md")).toBe(dirty("One"));
  expect(batch.rows()[0]!.error).toContain("rules changed");
});

it("preserves external writing during Undo and keeps an unfinished Undo retryable", async () => {
  const { files, prepare, space } = await setup();
  const batch = await prepare();
  await batch.apply(["one.md", "two.md"]);
  await files.write("two.md", encodeText("Words written afterward\n"));
  await batch.undo();
  expect(await space.read("two.md")).toBe("Words written afterward\n");
  expect(batch.rows()[1]).toMatchObject({ status: "undo-failed" });
  expect(batch.hasUndo()).toBe(true);
  await files.write("two.md", encodeText(clean("Two")));
  await batch.undo();
  expect(await space.read("one.md")).toBe(dirty("One"));
  expect(await space.read("two.md")).toBe(dirty("Two"));
  expect(batch.hasUndo()).toBe(false);
});

it("validates every path and history group before file access, and refuses unreviewed selections", async () => {
  const { files, prepare } = await setup();
  const reads = vi.spyOn(files, "read");
  for (const path of ["../outside.md", ".slate/history/old/note.md", "image.png"]) await expect(prepare(["one.md", path])).rejects.toThrow();
  await expect(prepare(["one.md"], "../outside")).rejects.toThrow();
  expect(reads).not.toHaveBeenCalled();
  const batch = await prepare(["one.md"]);
  await expect(batch.apply(["two.md"])).rejects.toThrow("reviewed");
});

it("stops a cancelled worker review before reading more files, including errors from another realm", async () => {
  const { files, space } = await setup();
  const stopped = { name: "AbortError", message: "Review closed" };
  const reads = vi.spyOn(files, "read");
  await expect(prepareTidyBatch({ space, paths: ["one.md", "two.md"], group: "cancelled", canWrite: () => true, fix: async () => { throw stopped; } })).rejects.toBe(stopped);
  expect(reads.mock.calls.map(([path]) => path)).not.toContain("two.md");
});

it("counts outstanding review items once when a rejected proposal also remains in the final report", async () => {
  const source = "+ One\n- Two\n";
  const { prepare } = await setup({ "one.md": source });
  const result = fix(source);
  expect(result.rejected.length).toBeGreaterThan(0);
  const batch = await prepare();
  expect(batch.rows()[0]!.manual).toBe(result.issues.length);
});
