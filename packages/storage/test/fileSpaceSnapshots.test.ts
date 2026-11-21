import { expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "../src/browserFiles";
import { createFileSpace, type FileSheet } from "../src/fileSpace";

it("uses each fresh adapter snapshot without listing or reading on the caller thread", async () => {
  const rows: FileSheet[][] = [[{ path: "বাংলা.MD", content: "\uFEFF# Before\r\n" }], [{ path: "বাংলা.MD", content: "\uFEFF# External revision\r\n" }]];
  const files = { ...createMemoryFiles(), list: vi.fn(async () => { throw Error("Caller traversal"); }),
    read: vi.fn(async () => { throw Error("Caller read"); }), snapshotMarkdown: vi.fn(async () => rows.shift()!) };
  const space = createFileSpace(files);
  expect(await space.sheets()).toEqual([{ path: "বাংলা.MD", content: "\uFEFF# Before\r\n" }]);
  expect(await space.sheets()).toEqual([{ path: "বাংলা.MD", content: "\uFEFF# External revision\r\n" }]);
  expect(files.list).not.toHaveBeenCalled(); expect(files.read).not.toHaveBeenCalled();
  expect(files.snapshotMarkdown).toHaveBeenCalledTimes(2);
});

it("surfaces a snapshot filesystem failure without silently reading a different source", async () => {
  const denied = new DOMException("Read permission revoked", "NotAllowedError");
  const files = { ...createMemoryFiles({ "note.md": "must not mask denied access" }), snapshotMarkdown: vi.fn(async () => { throw denied; }) };
  await expect(createFileSpace(files).sheets()).rejects.toBe(denied);
});

it("retains physical Markdown and unsupported encoding on adapters without snapshots", async () => {
  const source = "\uFEFF# Words\r\n\r\nKeep বাংলা.\r\n", files = createMemoryFiles({ "Note.MD": source, "asset.txt": "skip", ".slate/private.md": "private" });
  await files.write("Legacy.md", new Uint8Array([0xff, 0xfe, 0x41, 0]));
  expect(await createFileSpace(files).sheets()).toEqual([
    { path: "Legacy.md", content: "", unsupportedEncoding: true }, { path: "Note.MD", content: source },
  ]);
  expect(Array.from((await files.read("Note.MD"))!)).toEqual(Array.from(encodeText(source)));
});

it("omits a file that disappears between listing and its snapshot read", async () => {
  const files = { ...createMemoryFiles({ "kept.md": "words" }), list: async () => ["gone.md", "kept.md"] };
  expect(await createFileSpace(files).sheets()).toEqual([{ path: "kept.md", content: "words" }]);
});
