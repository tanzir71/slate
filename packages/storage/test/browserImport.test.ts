import { describe, expect, it } from "vitest";
import { addBrowserImportEntry, collectBrowserDrop } from "../src/browserImport";

describe("folder imports", () => {
  it("keeps duplicate names from multiple picked files or archives", () => {
    const entries: Record<string, Uint8Array> = {};
    addBrowserImportEntry(entries, "note.md", new Uint8Array([1]));
    addBrowserImportEntry(entries, "note.md", new Uint8Array([2]));
    expect(Array.from(entries["note.md"]!)).toEqual([1]);
    expect(Array.from(entries["note (1).md"]!)).toEqual([2]);
  });
  it("reads every directory batch and keeps nested paths", async () => {
    const fileEntry = (name: string) => ({ name, isFile: true, file: (done: (file: File) => void) => done(new File([name], name)) });
    const batches = [[fileEntry("first.md")], [fileEntry("second.md")], []];
    const directory = { name: "notes", isDirectory: true, createReader: () => ({ readEntries: (done: (entries: unknown[]) => void) => done(batches.shift() ?? []) }) };
    const data = { items: [{ kind: "file", webkitGetAsEntry: () => directory, getAsFile: () => null }], files: [] } as unknown as Pick<DataTransfer, "items" | "files">;
    expect((await collectBrowserDrop(data)).map((entry) => entry.path)).toEqual(["notes/first.md", "notes/second.md"]);
  });
});
