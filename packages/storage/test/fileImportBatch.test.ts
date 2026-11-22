import { expect, it, vi } from "vitest";
import { createFileSpace } from "../src/fileSpace";
import { createMemoryFiles, encodeText } from "../src/browserFiles";
import type { CheckedWorkspaceFiles } from "../src/fileIO";

function setup(initial: Record<string, string> = {}) {
  const disk = createMemoryFiles(initial);
  const create = vi.fn(async (path: string, bytes: Uint8Array) => {
    if (await disk.read(path) !== undefined) return false;
    await disk.write(path, bytes); return true;
  });
  const files: CheckedWorkspaceFiles = { list: disk.list, read: disk.read, operations: {
    createNew: create, save: vi.fn(), move: vi.fn(), trash: vi.fn(),
  } };
  let owned = true;
  return { disk, create, space: createFileSpace(files, () => owned), loseOwnership: () => { owned = false; } };
}
it("reserves a new notebook and keeps all fixed note/asset paths and existing bytes", async () => {
  const app = setup({ "Imported from Notion/Existing.md": "\ufeffPrior\r\n", "kept.md": "Original" });
  const note = encodeText("\ufeff# Note\r\n![pic](assets/pic.png)\r\n"), image = new Uint8Array([0, 1, 255]);
  const batch = app.space.prepareImport("Imported from Notion", { "Note.md": note, "assets/pic.png": image });
  const paths = await batch.run();
  expect(batch.root).toBe("Imported from Notion (2)"); expect(paths).toEqual(["Imported from Notion (2)/Note.md", "Imported from Notion (2)/assets/pic.png"]);
  expect(await app.disk.read(paths[0]!)).toEqual(note); expect(await app.disk.read(paths[1]!)).toEqual(image);
  expect(await app.space.read("Imported from Notion/Existing.md")).toBe("\ufeffPrior\r\n"); expect(await app.space.read("kept.md")).toBe("Original");
});
it("retries partial writes at the same root without duplicating or renaming any linked file", async () => {
  const app = setup(), create = app.create.getMockImplementation()!;
  let fail = true;
  app.create.mockImplementation(async (path, bytes) => { if (path.endsWith("image.png") && fail) throw Error("Disk disconnected"); return create(path, bytes); });
  const batch = app.space.prepareImport("Imported from Bear", { "Note.md": encodeText("![pic](image.png)"), "image.png": new Uint8Array([4, 5]) });
  await expect(batch.run()).rejects.toThrow("Files saved so far remain in Imported from Bear");
  expect(await app.space.read("Imported from Bear/Note.md")).toBe("![pic](image.png)");
  fail = false; expect(await batch.run()).toEqual(["Imported from Bear/Note.md", "Imported from Bear/image.png"]);
  expect((await app.disk.list(true)).filter(path => /Note.*\.md$/.test(path))).toEqual(["Imported from Bear/Note.md"]);
});
it("retains an external collision and stops instead of renaming a linked attachment", async () => {
  const app = setup(), create = app.create.getMockImplementation()!;
  app.create.mockImplementation(async (path, bytes) => {
    if (path.endsWith("pic.png")) { await app.disk.write(path, new Uint8Array([99])); return false; }
    return create(path, bytes);
  });
  const batch = app.space.prepareImport("Imported", { "Note.md": encodeText("![image](pic.png)"), "pic.png": new Uint8Array([1]) });
  await expect(batch.run()).rejects.toThrow("already exists");
  expect(await app.disk.read("Imported/pic.png")).toEqual(new Uint8Array([99]));
  expect(await app.space.read("Imported/Note.md")).toBe("![image](pic.png)");
  expect((await app.disk.list(true)).some(path => path.includes("pic ("))).toBe(false);
});
it("recovers lost marker and file replies by comparing the same proposal bytes", async () => {
  const app = setup(), create = app.create.getMockImplementation()!;
  let markerLost = true, fileLost = true;
  app.create.mockImplementation(async (path, bytes) => {
    const result = await create(path, bytes);
    if (path.endsWith(".slate-import.json") && markerLost) { markerLost = false; throw Error("Marker reply lost"); }
    if (path.endsWith("Note.md") && fileLost) { fileLost = false; throw Error("File reply lost"); }
    return result;
  });
  const batch = app.space.prepareImport("Imported", { "Note.md": encodeText("Exact words") });
  await expect(batch.run()).rejects.toThrow("Marker reply lost");
  await expect(batch.run()).rejects.toThrow("File reply lost");
  expect(await batch.run()).toEqual(["Imported/Note.md"]);
  expect((await app.disk.list(true)).sort()).toEqual(["Imported/.slate-import.json", "Imported/Note.md"]);
});
it("does not replace a completed import file edited before retry", async () => {
  const app = setup(), batch = app.space.prepareImport("Imported", { "Note.md": encodeText("Initial") });
  await batch.run(); await app.disk.write("Imported/Note.md", encodeText("External edits"));
  await expect(batch.run()).rejects.toThrow("file changed");
  expect(await app.space.read("Imported/Note.md")).toBe("External edits");
});
it("captures proposal bytes and waits for the mutation queue before Close flush can finish", async () => {
  const app = setup(), create = app.create.getMockImplementation()!;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  app.create.mockImplementation(async (path, bytes) => { if (path.endsWith("Note.md")) await held; return create(path, bytes); });
  const proposed = encodeText("Original proposal"), batch = app.space.prepareImport("Imported", { "Note.md": proposed });
  proposed.fill(0); const run = batch.run(); let flushed = false;
  const flush = app.space.flush().then(() => { flushed = true; });
  await Promise.resolve(); expect(flushed).toBe(false);
  release(); await run; await flush;
  expect(await app.space.read("Imported/Note.md")).toBe("Original proposal");
});
it("checks ownership and validates every portable path before creating a manifest", async () => {
  const app = setup();
  for (const entries of [{ "../out.md": encodeText("No") }, { "CON.md": encodeText("No") }, { ".slate-import.json": encodeText("No") }, { "A.md": encodeText("One"), "a.md": encodeText("Two") }, { "folder": encodeText("File"), "folder/note.md": encodeText("Note") }]) expect(() => app.space.prepareImport("Imported", entries)).toThrow();
  expect(app.create).not.toHaveBeenCalled();
  app.loseOwnership(); await expect(app.space.prepareImport("Imported", { "note.md": encodeText("No") }).run()).rejects.toThrow("read-only");
  expect(app.create).not.toHaveBeenCalled();
});
it("supports a serialized browser-library adapter and avoids case-folded existing roots", async () => {
  const disk = createMemoryFiles({ "imported/Note.md": "Existing" }), space = createFileSpace(disk);
  const one = space.prepareImport("Imported", { "One.md": encodeText("One") }), two = space.prepareImport("Imported", { "Two.md": encodeText("Two") });
  await Promise.all([one.run(), two.run()]);
  expect(one.root).toBe("Imported (2)"); expect(two.root).toBe("Imported (3)"); expect(await space.read("imported/Note.md")).toBe("Existing");
});
