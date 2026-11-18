import { expect, it, vi } from "vitest";
import { createBrowserSpace } from "@slate/storage/browser-space";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createBlockLibrary } from "../src/blocks/blockLibrary";
const path = ".slate/blocks/Quote.md",
  id = "custom:" + path;
const setup = () => {
  const files = createMemoryFiles({ [path]: "> Quote" });
  return {
    files,
    library: createBlockLibrary(createBrowserSpace(files), () => true),
  };
};
it("caches real files, retains unchanged snapshots and does not read while searching metadata", async () => {
  const { files, library } = setup(),
    write = vi.spyOn(files, "write");
  await library.refresh();
  const first = library.getSnapshot();
  expect(first.blocks[0]).toMatchObject({ id, source: "> Quote" });
  await library.refresh();
  expect(library.getSnapshot()).toBe(first);
  const read = vi.spyOn(files, "read");
  expect(
    library
      .getSnapshot()
      .blocks.filter((block) => block.label.includes("Quote")),
  ).toHaveLength(1);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
it("reports individual bad files and a failed listing without silently offering stale definitions", async () => {
  const { files, library } = setup();
  await files.write(".slate/blocks/Binary.md", new Uint8Array([255]));
  await library.refresh();
  expect(library.getSnapshot().files[0]?.status).toBe("unsupported");
  expect(library.getSnapshot().blocks).toHaveLength(1);
  vi.spyOn(files, "list").mockRejectedValueOnce(new Error("Cannot list files"));
  await library.refresh();
  expect(library.getSnapshot()).toMatchObject({
    error: "Cannot list files",
    blocks: [],
  });
  await library.refresh();
  expect(library.getSnapshot().blocks).toHaveLength(1);
});
it("rejects a changed or removed fragment, refreshes its preview and retains the actual file", async () => {
  const { files, library } = setup();
  await library.refresh();
  await files.write(path, encodeText("> External"));
  await expect(library.resolve(id)).rejects.toThrow("changed");
  expect(library.getSnapshot().blocks[0]?.source).toBe("> External");
  expect((await library.resolve(id)).source).toBe("> External");
  await files.remove(path);
  await expect(library.resolve(id)).rejects.toThrow("removed");
  expect(library.getSnapshot().blocks).toEqual([]);
});
it("checks write ownership before and after an asynchronous fragment read", async () => {
  let owned = true;
  const files = createMemoryFiles({ [path]: "> Quote" }),
    library = createBlockLibrary(createBrowserSpace(files), () => owned);
  await library.refresh();
  owned = false;
  const read = vi.spyOn(files, "read");
  await expect(library.resolve(id)).rejects.toThrow("read-only");
  expect(read).not.toHaveBeenCalled();
  owned = true;
  read.mockImplementationOnce(async () => {
    owned = false;
    return encodeText("> Quote");
  });
  await expect(library.resolve(id)).rejects.toThrow("read-only");
});
it("keeps committed creates successful if notification or the following refresh fails", async () => {
  const files = createMemoryFiles(),
    notify = vi.fn(() => {
      throw new Error("Messaging blocked");
    }),
    library = createBlockLibrary(createBrowserSpace(files), () => true, notify);
  vi.spyOn(files, "list").mockRejectedValueOnce(new Error("Refresh failed"));
  const saved = await library.create("New", "> New");
  expect(saved.conflict).toBe(false);
  expect(await files.read(saved.path)).toEqual(encodeText("> New"));
  expect(library.getSnapshot().error).toBe("Refresh failed");
  expect(notify).toHaveBeenCalledOnce();
  await library.refresh();
  expect(library.getSnapshot().blocks[0]?.source).toBe("> New");
});
it("keeps the changed primary as the current definition after a conflict save", async () => {
  const { files, library } = setup();
  await library.refresh();
  const base = library.getSnapshot().files[0]!;
  await files.write(path, encodeText("> External"));
  const saved = await library.save(base, "> Local");
  expect(saved.conflict).toBe(true);
  expect(
    library.getSnapshot().blocks.find((block) => block.id === id)?.source,
  ).toBe("> External");
  expect(await files.read(saved.path)).toEqual(encodeText("> Local"));
});
it("discards old refresh results and refuses an insertion after its Space is disposed", async () => {
  const { files, library } = setup();
  await library.refresh();
  let release!: (value: Uint8Array) => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(files, "read").mockImplementationOnce(() => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const old = library.refresh();
  await started;
  await files.write(path, encodeText("> Latest"));
  await library.refresh();
  release(encodeText("> Old"));
  await old;
  expect(library.getSnapshot().blocks[0]?.source).toBe("> Latest");
  library.dispose();
  await expect(library.resolve(id)).rejects.toThrow("closed");
  await expect(library.create("Closed", "Text")).rejects.toThrow("closed");
});

it("rejects a stale rendered preview even when the cache refreshed before the choice", async () => {
  const { files, library } = setup();
  await library.refresh();
  const preview = library.getSnapshot().blocks[0]!;
  await files.write(path, encodeText("> Changed"));
  await library.refresh();
  const read = vi.spyOn(files, "read");
  await expect(library.resolve(id, preview.source)).rejects.toThrow("changed");
  expect(read).not.toHaveBeenCalled();
  expect((await library.resolve(id, "> Changed")).source).toBe("> Changed");
});
