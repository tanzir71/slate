import { expect, it } from "vitest";
import { createDirectoryFiles, encodeText, type BrowserDirectoryHandle, type BrowserFileHandle } from "../src/browserFiles";
import { createBrowserSpace } from "../src/browserSpace";
import { readSpaceTemplates } from "../src/browserTemplates";
import { readSpaceBlocks } from "../src/browserBlocks";

function fixture(category: "templates" | "blocks", present: boolean, options: { nested?: boolean; fileAt?: ".slate" | "library"; denied?: boolean } = {}) {
  const visited: string[] = [];
  const source = "> Keep {{date}} and literal words.\r\n";
  function file(name: string): BrowserFileHandle {
    const bytes = encodeText(source);
    return { kind: "file", name,
      getFile: async () => ({ size: bytes.length, lastModified: 1, text: async () => source, arrayBuffer: async () => Uint8Array.from(bytes).buffer }),
      createWritable: async () => { throw Error("Reading a private library must not write."); },
    };
  }
  function directory(name: string, children: Record<string, BrowserDirectoryHandle | BrowserFileHandle>): BrowserDirectoryHandle {
    return { kind: "directory", name,
      async *entries() {
        visited.push(name);
        if (options.denied && name === category) throw new DOMException("Denied", "NotAllowedError");
        yield* Object.entries(children);
      },
      async getDirectoryHandle(child, options) {
        if (options?.create) throw Error("Reading a private library must not create a directory.");
        if (denied && child === category) throw new DOMException("Denied", "NotAllowedError");
        const entry = children[child];
        if (!entry) throw new DOMException("Missing", "NotFoundError");
        if (entry.kind !== "directory") throw new DOMException("Not a directory", "TypeMismatchError");
        return entry;
      },
      async getFileHandle(child) {
        const entry = children[child];
        if (!entry) throw new DOMException("Missing", "NotFoundError");
        if (entry.kind !== "file") throw new DOMException("Not a file", "TypeMismatchError");
        return entry;
      },
      removeEntry: async () => { throw Error("Reading a private library must not remove files."); },
    };
  }
  const denied = options.denied;
  const library = options.fileAt === "library" ? file(category) : directory(category, {
    "kept.md": file("kept.md"), ...(options.nested ? { Nested: directory("Nested", { "বাংলা.MD": file("বাংলা.MD") }) } : {}),
  });
  const unrelated = directory("Notes", { "unrelated.md": file("unrelated.md") });
  const privateEntry = options.fileAt === ".slate" ? file(".slate") : directory(".slate", { [category]: library });
  const root = directory("root", { Notes: unrelated, ...(present ? { ".slate": privateEntry } : {}) });
  const files = createDirectoryFiles(root), space = createBrowserSpace(files);
  return { visited, source, files, read: () => category === "templates" ? readSpaceTemplates(space) : readSpaceBlocks(space) };
}

it.each(["templates", "blocks"] as const)("reading %s traverses its private library without enumerating user notes", async category => {
  const app = fixture(category, true);
  const records = await app.read();
  expect(records.map(record => record.path)).toEqual([`.slate/${category}/kept.md`]);
  expect(records[0]?.source).toBe(app.source);
  expect(app.visited).toEqual([category]);
});

it.each(["templates", "blocks"] as const)("a missing %s directory is empty without scanning or creating other folders", async category => {
  const app = fixture(category, false);
  expect(await app.read()).toEqual([]);
  expect(app.visited).toEqual([]);
});

it.each(["templates", "blocks"] as const)("scoped %s reads retain nested Unicode paths, ordering and physical text", async category => {
  const app = fixture(category, true, { nested: true });
  const records = await app.read();
  expect(records.map(record => record.path)).toEqual([`.slate/${category}/Nested/বাংলা.MD`, `.slate/${category}/kept.md`]);
  expect(records.every(record => record.source === app.source)).toBe(true);
  expect(app.visited).toEqual([category, "Nested"]);
});

for (const fileAt of [".slate", "library"] as const) {
  it.each(["templates", "blocks"] as const)(`a file in place of ${fileAt} remains intact when reading %s`, async category => {
    const app = fixture(category, true, { fileAt });
    expect(await app.read()).toEqual([]);
    const path = fileAt === ".slate" ? ".slate" : `.slate/${category}`;
    expect(Array.from((await app.files.read(path))!)).toEqual(Array.from(encodeText(app.source)));
    expect(app.visited).toEqual([]);
  });
}

it.each(["templates", "blocks"] as const)("denied access to %s stays an error without enumerating notes", async category => {
  const app = fixture(category, true, { denied: true });
  await expect(app.read()).rejects.toMatchObject({ name: "NotAllowedError" });
  expect(app.visited).toEqual([]);
});
