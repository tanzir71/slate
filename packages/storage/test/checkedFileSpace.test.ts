import { expect, it, vi } from "vitest";
import { createFileSpace } from "../src/fileSpace";
import { createMemoryFiles, encodeText } from "../src/browserFiles";
import type { CheckedWorkspaceFiles } from "../src/fileIO";
import { exportBrowserArchive, readBrowserArchive } from "../src/browserArchive";

async function setup(initial: Record<string, string | Uint8Array> = {}) {
  const disk = createMemoryFiles();
  for (const [path, value] of Object.entries(initial)) await disk.write(path, typeof value === "string" ? encodeText(value) : value);
  const operations = {
    createNew: vi.fn(async (path: string, bytes: Uint8Array) => {
      if (await disk.read(path) !== undefined) return false;
      await disk.write(path, bytes); return true;
    }),
    save: vi.fn(async (path: string, bytes: Uint8Array, base: Uint8Array | undefined) => {
      const current = await disk.read(path);
      const matches = current === undefined ? base === undefined : base !== undefined && current.length === base.length && current.every((byte, index) => byte === base[index]);
      const target = matches ? path : path + ".conflict.md";
      await disk.write(target, bytes); return { path: target, conflict: !matches };
    }),
    move: vi.fn(async (from: string, to: string, base: Uint8Array) => {
      const current = await disk.read(from);
      if (!current || current.toString() !== base.toString()) throw new Error("Changed source");
      if (await disk.read(to) !== undefined) throw new Error("Existing destination");
      await disk.write(to, current); await disk.remove(from);
    }),
    trash: vi.fn(async (path: string, base: Uint8Array) => {
      const current = await disk.read(path);
      if (!current || current.toString() !== base.toString()) throw new Error("Changed source");
      const target = ".slate/trash/1/" + path;
      await disk.write(target, current); await disk.remove(path); return target;
    }),
  };
  const files: CheckedWorkspaceFiles = { list: disk.list, read: disk.read, operations };
  return { disk, operations, files, space: createFileSpace(files) };
}

it("uses atomic create operations for sheets, canonical daily notes, imports and numbered assets", async () => {
  const { disk, operations, space } = await setup({ "note.md": "Original", "image-1.png": new Uint8Array([1]) });
  expect((await space.create("note.md", "New")).path).toBe("note (1).md");
  expect(await space.createIfMissing("note.md", "Overwrite")).toBeUndefined();
  expect((await space.createIfMissing("Daily/2026-11-19.md", "Today"))?.content).toBe("Today");
  expect(await space.importFiles({ "note.md": encodeText("Imported") })).toEqual(["note (2).md"]);
  expect(await space.importNumberedFile("image.png", new Uint8Array([2, 3]))).toBe("image-2.png");
  expect(await disk.read("image-1.png")).toEqual(new Uint8Array([1]));
  expect(await disk.read("image-2.png")).toEqual(new Uint8Array([2, 3]));
  expect(operations.createNew).toHaveBeenCalled();
});

it("sends the captured raw disk bytes to a checked save and exposes a late external conflict", async () => {
  const original = "\uFEFF# Original\r\n";
  const { disk, operations, space } = await setup({ "note.md": original });
  const save = operations.save.getMockImplementation()!;
  operations.save.mockImplementationOnce(async (path, bytes, base) => {
    await disk.write(path, encodeText("External revision\r\n"));
    return save(path, bytes, base);
  });
  expect(await space.save("note.md", "My revision\r\n", original)).toMatchObject({ conflict: true, path: "note.md.conflict.md", content: "My revision\r\n" });
  expect(operations.save).toHaveBeenCalledExactlyOnceWith("note.md", encodeText("My revision\r\n"), encodeText(original));
  expect(await space.read("note.md")).toBe("External revision\r\n");
  expect(await space.read("note.md.conflict.md")).toBe("My revision\r\n");
});

it("keeps snapshot comparison exact and preserves a JSON BOM when authorizing the backend", async () => {
  const original = "\uFEFF{\"version\":1}\r\n";
  const { operations, space } = await setup({ ".slate/view.json": original });
  const edited = '{"version":1,"density":"compact"}\r\n';
  expect((await space.save(".slate/view.json", edited, original.slice(1))).conflict).toBe(false);
  expect(operations.save).toHaveBeenCalledExactlyOnceWith(".slate/view.json", encodeText(edited), encodeText(original));
});

it("delegates moves and trash with original bytes and does not call an unchecked remove", async () => {
  const original = "\uFEFFWords\r\n";
  const { disk, operations, space } = await setup({ "note.md": original });
  await space.move("note.md", "Book/note.md", original);
  expect(operations.move).toHaveBeenCalledExactlyOnceWith("note.md", "Book/note.md", encodeText(original));
  expect(await disk.read("note.md")).toBeUndefined();
  const target = await space.trash("Book/note.md", original);
  expect(operations.trash).toHaveBeenCalledExactlyOnceWith("Book/note.md", encodeText(original));
  expect(await disk.read(target)).toEqual(encodeText(original));
});

it("checks ownership and every import path before calling any mutation capability", async () => {
  const { files, operations, disk } = await setup({ "note.md": "Original" });
  const readonly = createFileSpace(files, () => false);
  await expect(readonly.save("note.md", "Edit", "Original")).rejects.toThrow("read-only");
  await expect(readonly.create("other.md", "New")).rejects.toThrow("read-only");
  const writable = createFileSpace(files);
  await expect(writable.importFiles({ "ok.md": encodeText("ok"), "../escape.md": encodeText("bad") })).rejects.toThrow("Invalid workspace path");
  expect(await disk.read("ok.md")).toBeUndefined();
  for (const operation of Object.values(operations)) expect(operation).not.toHaveBeenCalled();
});

it("lets the checked backend resolve a case-only rename on a case-insensitive disk", async () => {
  const { files, operations } = await setup({ "note.md": "Words" });
  files.read = vi.fn(async () => encodeText("Words"));
  operations.move.mockResolvedValueOnce(undefined);
  expect(await createFileSpace(files).move("note.md", "Note.md", "Words")).toEqual({ path: "Note.md", content: "Words" });
  expect(operations.move).toHaveBeenCalledExactlyOnceWith("note.md", "Note.md", encodeText("Words"));
});

it("keeps an unsupported file and routes its attempted replacement to a new conflict file", async () => {
  const { disk, operations, space } = await setup({ "note.md": new Uint8Array([0xff]) });
  expect((await space.save("note.md", "My words", undefined)).conflict).toBe(true);
  expect(await disk.read("note.md")).toEqual(new Uint8Array([0xff]));
  expect(operations.save).not.toHaveBeenCalled();
});

it("exports every exact byte through the shared read-only protocol without mutation access", async () => {
  const source = new Uint8Array([0xef, 0xbb, 0xbf, 0xff]);
  const { files, operations } = await setup({ "note.md": source, ".slate/view.json": "{}" });
  const restored = await readBrowserArchive(await exportBrowserArchive(files));
  expect(Array.from(restored["note.md"]!)).toEqual(Array.from(source));
  expect(Array.from(restored[".slate/view.json"]!)).toEqual(Array.from(encodeText("{}")));
  for (const operation of Object.values(operations)) expect(operation).not.toHaveBeenCalled();
});
