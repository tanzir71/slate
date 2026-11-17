import { describe, expect, it } from "vitest";
import { createMemoryFiles, decodeText, encodeText, safeBrowserPath } from "../src/browserFiles";
import { createBrowserSpace } from "../src/browserSpace";
import { exportBrowserArchive, readBrowserArchive } from "../src/browserArchive";

describe("browser Spaces", () => {
  it("persists Markdown in its file source and rebuilds the sheet list from files", async () => {
    const files = createMemoryFiles();
    const space = createBrowserSpace(files);
    await space.create("Drafts/Hello.md", "# Hello\n\nMy words.");
    expect(await createBrowserSpace(files).sheets()).toEqual([{ path: "Drafts/Hello.md", content: "# Hello\n\nMy words." }]);
    await space.save("Drafts/Hello.md", "# Hello\n\nEdited.", "# Hello\n\nMy words.");
    expect(decodeText((await files.read("Drafts/Hello.md"))!)).toBe("# Hello\n\nEdited.");
  });

  it("preserves both divergent edits and never replaces an existing conflict copy", async () => {
    const files = createMemoryFiles({ "note.md": "external words" });
    const space = createBrowserSpace(files);
    const first = await space.save("note.md", "my words", "old words");
    const second = await space.save("note.md", "other words", "old words");
    expect(first.conflict).toBe(true);
    expect(second.path).not.toBe(first.path);
    expect(await space.read("note.md")).toBe("external words");
    expect(await space.read(first.path)).toBe("my words");
    expect(await space.read(second.path)).toBe("other words");
  });

  it("serializes concurrent creates and refuses to overwrite move destinations", async () => {
    const files = createMemoryFiles();
    const space = createBrowserSpace(files);
    const [first, second] = await Promise.all([space.create("new.md", "one"), space.create("new.md", "two")]);
    expect(first.path).not.toBe(second.path);
    await expect(space.move(first.path, second.path, "one")).rejects.toThrow("already exists");
    expect(await space.read(first.path)).toBe("one");
    expect(await space.read(second.path)).toBe("two");
  });

  it("recovers deleted sheets from trash and preserves externally changed sheets", async () => {
    const files = createMemoryFiles({ "Drafts/note.md": "words" });
    const space = createBrowserSpace(files);
    await expect(space.trash("Drafts/note.md", "stale words")).rejects.toThrow("changed outside");
    const path = await space.trash("Drafts/note.md", "words");
    expect(await space.sheets()).toEqual([]);
    expect(await space.read(path)).toBe("words");
    expect(await files.list()).toEqual([]);
    expect(await files.list(true)).toEqual([path]);
  });

  it("fails closed without write ownership but continues to allow reads", async () => {
    const files = createMemoryFiles({ "note.md": "words" });
    const space = createBrowserSpace(files, () => false);
    await expect(space.save("note.md", "new", "words")).rejects.toThrow("read-only");
    await expect(space.create("new.md", "new")).rejects.toThrow("read-only");
    await expect(space.trash("note.md", "words")).rejects.toThrow("read-only");
    expect(await space.read("note.md")).toBe("words");
  });

  it("round trips zip files byte-identically including binary assets and private config", async () => {
    const files = createMemoryFiles({ "notes/Unicode.md": "# বাংলা\r\n\r\nWords.\r\n", ".slate/snippets.json": "{}" });
    await files.write("assets/image.bin", new Uint8Array([0, 255, 128, 42]));
    const entries = await readBrowserArchive(await exportBrowserArchive(files));
    const restored = createBrowserSpace(createMemoryFiles());
    await restored.importFiles(entries);
    for (const path of await files.list(true)) {
      expect(Array.from((await restored.files.read(path))!)).toEqual(Array.from((await files.read(path))!));
    }
    const duplicates = await restored.importFiles(entries);
    expect(duplicates).toContain("notes/Unicode (1).md");
    expect(await restored.read("notes/Unicode.md")).toBe("# বাংলা\r\n\r\nWords.\r\n");
  });

  it("validates every imported path before writing and rejects directory traversal", async () => {
    const space = createBrowserSpace(createMemoryFiles());
    await expect(space.importFiles({ "good.md": encodeText("yes"), "../escape.md": encodeText("no") })).rejects.toThrow("Invalid workspace path");
    expect(await space.sheets()).toEqual([]);
    for (const path of ["/absolute.md", "C:\\notes.md", "../notes.md", "a/../notes.md", "a//b.md", "a/./b.md"]) {
      expect(() => safeBrowserPath(path)).toThrow();
    }
  });
});
