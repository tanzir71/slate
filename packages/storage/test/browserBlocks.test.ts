import { afterEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "../src/browserFiles";
import { createBrowserSpace } from "../src/browserSpace";
import {
  createSpaceBlock,
  readSpaceBlock,
  readSpaceBlocks,
  saveSpaceBlock,
} from "../src/browserBlocks";

const path = ".slate/blocks/Quote.md";
afterEach(() => {
  vi.restoreAllMocks();
});

it("reads only custom Markdown files, with nested names and exact BOM/line endings, without writing", async () => {
  const source =
    "\uFEFF---\r\nname: Literal\r\n---\r\n> {{date}} ${1:Text}$0\r\n";
  const files = createMemoryFiles({
    [path]: source,
    ".slate/blocks/Nested/বাংলা.MD": "",
    ".slate/blocks/config.json": "{}",
    ".slate/templates/Other.md": "Other",
    "note.md": "Note",
  });
  const write = vi.spyOn(files, "write"),
    records = await readSpaceBlocks(createBrowserSpace(files));
  expect(records.map((entry) => entry.path)).toEqual([
    ".slate/blocks/Nested/বাংলা.MD",
    path,
  ]);
  expect(records[1]).toMatchObject({
    status: "valid",
    source,
    block: { source, label: "Quote" },
    bytes: encodeText(source),
  });
  expect(records[0]).toMatchObject({
    status: "valid",
    source: "",
    block: { label: "বাংলা" },
  });
  expect(write).not.toHaveBeenCalled();
});

it("distinguishes missing, invalid UTF-8, oversized text and unavailable reads while keeping good files", async () => {
  const files = createMemoryFiles({
    [path]: "> Good",
    ".slate/blocks/Large.md": "x".repeat(1_048_577),
    ".slate/blocks/Unavailable.md": "Keep",
  });
  await files.write(".slate/blocks/Binary.md", new Uint8Array([255, 254, 0]));
  const read = files.read;
  vi.spyOn(files, "read").mockImplementation(async (name) => {
    if (name.endsWith("Unavailable.md")) throw new Error("Read failed");
    return read(name);
  });
  const space = createBrowserSpace(files),
    records = await readSpaceBlocks(space);
  expect(records.map((entry) => [entry.block?.label, entry.status])).toEqual([
    [undefined, "unsupported"],
    [undefined, "invalid"],
    ["Quote", "valid"],
    [undefined, "unavailable"],
  ]);
  expect(records[0]?.bytes).toEqual(new Uint8Array([255, 254, 0]));
  expect(records[1]?.source?.length).toBe(1_048_577);
  expect(await readSpaceBlock(space, ".slate/blocks/Missing.md")).toEqual({
    path: ".slate/blocks/Missing.md",
    status: "missing",
  });
});

it("does not turn listing failures into an empty catalog or keep a file removed during listing", async () => {
  const files = createMemoryFiles({ [path]: "> Good" }),
    space = createBrowserSpace(files);
  const list = vi
    .spyOn(files, "list")
    .mockRejectedValueOnce(new Error("List failed"));
  await expect(readSpaceBlocks(space)).rejects.toThrow("List failed");
  list.mockResolvedValueOnce([path]);
  await files.remove(path);
  expect(await readSpaceBlocks(space)).toEqual([]);
});

it("creates numbered portable copies and keeps an existing empty file and concurrent proposals", async () => {
  const files = createMemoryFiles({ [path]: "" }),
    space = createBrowserSpace(files);
  const saved = await Promise.all([
    createSpaceBlock(space, "Quote", "> First"),
    createSpaceBlock(space, "Quote", "> Second"),
  ]);
  expect(saved.map((entry) => entry.path)).toEqual([
    ".slate/blocks/Quote (1).md",
    ".slate/blocks/Quote (2).md",
  ]);
  expect(await space.read(path)).toBe("");
  expect(await space.read(saved[0]!.path)).toBe("> First");
  await expect(createSpaceBlock(space, "CON", "> Text")).rejects.toThrow();
});

it("saves literal UTF-8/BOM text against the exact byte snapshot", async () => {
  const before = "\uFEFF> Before\r\n",
    after = "\uFEFF> After {{date}} ${1:Text}$0\r\n",
    files = createMemoryFiles({ [path]: before }),
    space = createBrowserSpace(files);
  const saved = await saveSpaceBlock(
    space,
    await readSpaceBlock(space, path),
    after,
  );
  expect(saved).toEqual({ path, content: after, conflict: false });
  expect(await files.read(path)).toEqual(encodeText(after));
});

it.each(["", "\uFEFF", "> External", "\uFEFF> Original"])(
  "keeps changed bytes and writes the proposed fragment to a conflict copy: %j",
  async (external) => {
    const files = createMemoryFiles({ [path]: "> Original" }),
      space = createBrowserSpace(files),
      base = await readSpaceBlock(space, path);
    await files.write(path, encodeText(external));
    const saved = await saveSpaceBlock(space, base, "> Local");
    expect(saved.conflict).toBe(true);
    expect(saved.path).not.toBe(path);
    expect(await files.read(path)).toEqual(encodeText(external));
    expect(await files.read(saved.path)).toEqual(encodeText("> Local"));
  },
);

it("preserves a file created after a missing snapshot, including an empty file", async () => {
  const files = createMemoryFiles(),
    space = createBrowserSpace(files),
    base = await readSpaceBlock(space, path);
  await files.write(path, encodeText(""));
  expect((await saveSpaceBlock(space, base, "> New")).conflict).toBe(true);
  expect(await files.read(path)).toEqual(encodeText(""));
});

it("can repair oversized valid UTF-8, but blocks unsupported/unavailable snapshots and invalid proposals", async () => {
  const files = createMemoryFiles({ [path]: "x".repeat(1_048_577) }),
    space = createBrowserSpace(files);
  expect(
    (await saveSpaceBlock(space, await readSpaceBlock(space, path), "> Short"))
      .conflict,
  ).toBe(false);
  await files.write(path, new Uint8Array([255]));
  await expect(
    saveSpaceBlock(space, await readSpaceBlock(space, path), "> Replacement"),
  ).rejects.toThrow(/read.*editable/i);
  await expect(
    saveSpaceBlock(
      space,
      { path, status: "unavailable", error: "Read failed" },
      "> Replacement",
    ),
  ).rejects.toThrow(/read.*editable/i);
  await expect(
    saveSpaceBlock(space, { path, status: "valid" }, "> Replacement"),
  ).rejects.toThrow(/read.*editable/i);
  expect(await files.read(path)).toEqual(new Uint8Array([255]));
  await expect(
    createSpaceBlock(space, "Large", "x".repeat(1_048_577)),
  ).rejects.toThrow("1 MiB");
});

it.each([
  "note.md",
  ".slate/templates/Quote.md",
  ".slate/blocks/../note.md",
  ".slate/blocks/Quote.txt",
  ".slate\\blocks\\Quote.md",
])(
  "never reads or writes outside canonical custom-block paths: %j",
  async (name) => {
    const files = createMemoryFiles({ "note.md": "Keep" }),
      space = createBrowserSpace(files),
      read = vi.spyOn(files, "read"),
      write = vi.spyOn(files, "write");
    await expect(readSpaceBlock(space, name)).rejects.toThrow();
    await expect(
      saveSpaceBlock(space, { path: name, status: "missing" }, "> Fragment"),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  },
);

it("enforces read-only ownership and leaves bytes intact", async () => {
  const files = createMemoryFiles({ [path]: "> Original" }),
    space = createBrowserSpace(files, () => false);
  await expect(createSpaceBlock(space, "New", "> New")).rejects.toThrow(
    /read-only/i,
  );
  await expect(
    saveSpaceBlock(space, await readSpaceBlock(space, path), "> Local"),
  ).rejects.toThrow(/read-only/i);
  expect(await files.list(true)).toEqual([path]);
  expect(await files.read(path)).toEqual(encodeText("> Original"));
});

it("keeps a later external deletion or encoding change and saves the proposal separately", async () => {
  for (const external of [undefined, new Uint8Array([255])]) {
    const files = createMemoryFiles({ [path]: "> Original" }),
      space = createBrowserSpace(files),
      base = await readSpaceBlock(space, path);
    if (external === undefined) await files.remove(path);
    else await files.write(path, external);
    const result = await saveSpaceBlock(space, base, "> Local");
    expect(result.conflict).toBe(true);
    expect(await files.read(path)).toEqual(external);
    expect(await files.read(result.path)).toEqual(encodeText("> Local"));
  }
});

it("treats an already committed proposal as idempotent without another conflict copy", async () => {
  const files = createMemoryFiles({ [path]: "> Original" }),
    space = createBrowserSpace(files),
    base = await readSpaceBlock(space, path);
  await files.write(path, encodeText("> Local"));
  expect((await saveSpaceBlock(space, base, "> Local")).conflict).toBe(false);
  expect(await files.list(true)).toEqual([path]);
});

it("recovers the shared write queue after a failed snapshot write", async () => {
  const files = createMemoryFiles({ [path]: "> Original" }),
    space = createBrowserSpace(files),
    base = await readSpaceBlock(space, path);
  vi.spyOn(files, "write").mockRejectedValueOnce(new Error("Disk full"));
  await expect(saveSpaceBlock(space, base, "> Local")).rejects.toThrow(
    "Disk full",
  );
  expect(await files.read(path)).toEqual(encodeText("> Original"));
  expect((await saveSpaceBlock(space, base, "> Local")).conflict).toBe(false);
});

it.each([false, true])(
  "serializes byte snapshots with other Space writes and checks queued ownership: %j",
  async (takeover) => {
    const files = createMemoryFiles({ [path]: "> Original" });
    let owned = true,
      started!: () => void,
      release!: () => void;
    const entered = new Promise<void>((resolve) => {
        started = resolve;
      }),
      paused = new Promise<void>((resolve) => {
        release = resolve;
      });
    const write = files.write;
    vi.spyOn(files, "write").mockImplementationOnce(async (name, bytes) => {
      started();
      await paused;
      await write(name, bytes);
    });
    const space = createBrowserSpace(files, () => owned),
      first = space.create("Note.md", "Kept");
    await entered;
    const base = encodeText("> Original"),
      next = space.saveSnapshot(path, "> Local", base);
    // Caller-owned byte arrays can change while the writer is queued.
    base.fill(0);
    if (takeover) owned = false;
    const outcome = next.then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    release();
    await first;
    const result = await outcome;
    if (takeover) {
      expect(result).toMatchObject({
        error: expect.objectContaining({
          message: expect.stringMatching(/read-only/i),
        }),
      });
      expect(await files.read(path)).toEqual(encodeText("> Original"));
    } else {
      expect(result).toMatchObject({ result: { path, conflict: false } });
      expect(await files.read(path)).toEqual(encodeText("> Local"));
    }
  },
);
