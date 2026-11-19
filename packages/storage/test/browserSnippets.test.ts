import { openGlobalSnippetFileStore } from "../src/browserCatalog";
import { expect, it, vi, afterEach } from "vitest";
import { createMemoryFiles, encodeText } from "../src/browserFiles";
import { createBrowserSpace } from "../src/browserSpace";
import {
  createSnippetFileStore,
  globalSnippetPath,
  spaceSnippetPath,
} from "../src/browserSnippets";

const original =
  '{"version":1,"custom":{"keep":true},"snippets":[{"trigger":";x","body":"${1:Name}$0","extra":"keep"}]}';
const replacement = original.replace("Name", "Writer");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("does not create files during missing reads or change unrelated Markdown/configuration", async () => {
  const files = createMemoryFiles({
    "note.md": "Keep",
    ".slate/space.json": "{}",
  });
  const store = createSnippetFileStore(createBrowserSpace(files));
  expect(await store.read()).toEqual({
    path: spaceSnippetPath,
    status: "missing",
  });
  expect(await files.list(true)).toEqual([".slate/space.json", "note.md"]);
  const result = await store.save(await store.read(), original);
  expect(result).toEqual({
    path: spaceSnippetPath,
    content: original,
    conflict: false,
  });
  expect(await files.read("note.md")).toEqual(encodeText("Keep"));
  expect(await store.read()).toMatchObject({
    status: "valid",
    source: original,
    configuration: { custom: { keep: true }, snippets: [{ extra: "keep" }] },
  });
});
it("retains exact JSON whitespace/metadata and permits an empty list to disable the scope", async () => {
  const space = createBrowserSpace(
    createMemoryFiles({ [spaceSnippetPath]: original }),
  );
  const store = createSnippetFileStore(space);
  const empty = '{\n  "version": 1, "snippets": [], "custom": "kept"\n}\n';
  await store.save(await store.read(), empty);
  expect(await space.read(spaceSnippetPath)).toBe(empty);
  expect((await store.read()).configuration?.snippets).toEqual([]);
});
it.each([
  "",
  "{broken",
  '{"version":2,"snippets":[]}',
  '{"version":1,"snippets":[{"trigger":"x","body":"${1:broken"}]}',
])(
  "keeps a malformed source available for explicit repair: %j",
  async (source) => {
    const space = createBrowserSpace(
      createMemoryFiles({ [spaceSnippetPath]: source }),
    );
    const store = createSnippetFileStore(space),
      snapshot = await store.read();
    expect(snapshot).toMatchObject({
      status: "invalid",
      source,
      error: expect.any(String),
    });
    expect(snapshot.configuration).toBeUndefined();
    await store.save(snapshot, original);
    expect(await space.read(spaceSnippetPath)).toBe(original);
  },
);
it("preserves unsupported original bytes and refuses to save over an unreadable snapshot", async () => {
  const files = createMemoryFiles(),
    bytes = new Uint8Array([0xff, 0xfe, 0]);
  await files.write(spaceSnippetPath, bytes);
  const store = createSnippetFileStore(createBrowserSpace(files)),
    snapshot = await store.read();
  expect(snapshot).toMatchObject({
    status: "unsupported",
    bytes,
  });
  expect(snapshot.source).toBeUndefined();
  await expect(store.save(snapshot, original)).rejects.toThrow(
    "editable snippet file",
  );
  expect(await files.read(spaceSnippetPath)).toEqual(bytes);
  expect(await files.list(true)).toEqual([spaceSnippetPath]);
});
it("reports real read failures without treating the file as absent or writable", async () => {
  const files = createMemoryFiles({ [spaceSnippetPath]: original });
  vi.spyOn(files, "read").mockRejectedValueOnce(new Error("Disk unavailable"));
  const store = createSnippetFileStore(createBrowserSpace(files)),
    snapshot = await store.read();
  expect(snapshot).toEqual({
    path: spaceSnippetPath,
    status: "unavailable",
    error: "Disk unavailable",
  });
  await expect(store.save(snapshot, replacement)).rejects.toThrow(
    "editable snippet file",
  );
  expect((await store.read()).source).toBe(original);
});
it("preserves external edits and returns a separate conflict copy of the exact proposed JSON", async () => {
  const files = createMemoryFiles({ [spaceSnippetPath]: original }),
    space = createBrowserSpace(files),
    store = createSnippetFileStore(space),
    snapshot = await store.read();
  const external = original.replace("Name", "External");
  await files.write(spaceSnippetPath, encodeText(external));
  const result = await store.save(snapshot, replacement);
  expect(result.conflict).toBe(true);
  expect(result.path).not.toBe(spaceSnippetPath);
  expect(await space.read(spaceSnippetPath)).toBe(external);
  expect(await space.read(result.path)).toBe(replacement);
});
it("does not replace a newly created empty file after a missing snapshot", async () => {
  const files = createMemoryFiles(),
    space = createBrowserSpace(files),
    store = createSnippetFileStore(space);
  const snapshot = await store.read();
  await files.write(spaceSnippetPath, encodeText(""));
  const result = await store.save(snapshot, original);
  expect(result.conflict).toBe(true);
  expect(await space.read(spaceSnippetPath)).toBe("");
  expect(await space.read(result.path)).toBe(original);
});
it("validates new JSON and writer ownership before any file is created", async () => {
  const files = createMemoryFiles(),
    writable = createSnippetFileStore(createBrowserSpace(files));
  await expect(writable.save(await writable.read(), "{}")).rejects.toThrow(
    "version 1",
  );
  const reader = createSnippetFileStore(createBrowserSpace(files, () => false));
  await expect(reader.save(await reader.read(), original)).rejects.toThrow(
    "read-only",
  );
  expect(await files.list(true)).toEqual([]);
});
it("serializes competing global writers across separate store instances before optimistic checks", async () => {
  const files = createMemoryFiles({ [globalSnippetPath]: original });
  let pending: Promise<unknown> = Promise.resolve();
  const lock = <T>(action: () => Promise<T>) => {
    const result = pending.then(action);
    pending = result.catch(() => undefined);
    return result;
  };
  const first = createSnippetFileStore(
      createBrowserSpace(files),
      globalSnippetPath,
      lock,
    ),
    second = createSnippetFileStore(
      createBrowserSpace(files),
      globalSnippetPath,
      lock,
    );
  const snapshots = await Promise.all([first.read(), second.read()]);
  const [saved, conflict] = await Promise.all([
    first.save(snapshots[0]!, replacement),
    second.save(snapshots[1]!, original.replace("Name", "Other")),
  ]);
  expect(saved.conflict).toBe(false);
  expect(conflict.conflict).toBe(true);
  expect(await files.read(globalSnippetPath)).toEqual(encodeText(replacement));
  expect(await files.read(conflict.path)).toEqual(
    encodeText(original.replace("Name", "Other")),
  );
});
it("rejects the wrong scope, unsafe paths and oversized proposed configuration without writes", async () => {
  const files = createMemoryFiles(),
    space = createBrowserSpace(files),
    store = createSnippetFileStore(space);
  expect(() =>
    createSnippetFileStore(space, "../note.md" as typeof spaceSnippetPath),
  ).toThrow("Invalid snippet");
  expect(() => createSnippetFileStore(space, globalSnippetPath)).toThrow(
    "shared lock",
  );
  await expect(
    store.save({ path: globalSnippetPath, status: "missing" }, original),
  ).rejects.toThrow("editable");
  await expect(
    store.save(await store.read(), " ".repeat(8 * 1_048_576 + 1)),
  ).rejects.toThrow("8 MiB");
  expect(await files.list(true)).toEqual([]);
});
it("reports missing OPFS support rather than inventing volatile global storage", async () => {
  vi.stubGlobal("navigator", { storage: {} });
  await expect(openGlobalSnippetFileStore()).rejects.toThrow(
    "private file storage",
  );
});

it("creates global files only on an explicit locked save and uses the shared profile lock", async () => {
  let directoryExists = false,
    bytes: Uint8Array | undefined;
  const getFileHandle = vi.fn(
    async (name: string, options?: { create?: boolean }) => {
      expect(name).toBe("snippets.json");
      if (!bytes && !options?.create)
        throw new DOMException("Missing file", "NotFoundError");
      return {
        getFile: async () => ({
          arrayBuffer: async () => bytes!.slice().buffer,
        }),
        createWritable: async () => {
          let pending: Uint8Array;
          return {
            write: async (next: Uint8Array) => {
              pending = next.slice();
            },
            close: async () => {
              bytes = pending;
            },
            abort: async () => undefined,
          };
        },
      };
    },
  );
  const getDirectoryHandle = vi.fn(
    async (name: string, options?: { create?: boolean }) => {
      expect(name).toBe("global");
      if (options?.create) directoryExists = true;
      if (!directoryExists)
        throw new DOMException("Missing folder", "NotFoundError");
      return { getFileHandle };
    },
  );
  const request = vi.fn(async (_name: string, action: () => Promise<unknown>) =>
    action(),
  );
  vi.stubGlobal("navigator", {
    storage: { getDirectory: async () => ({ getDirectoryHandle }) },
    locks: { request },
  });
  const store = await openGlobalSnippetFileStore(),
    snapshot = await store.read();
  expect(snapshot.status).toBe("missing");
  expect(directoryExists).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(getFileHandle).not.toHaveBeenCalled();
  await store.save(snapshot, original);
  expect(request).toHaveBeenCalledWith(
    "slate:global-snippets",
    expect.any(Function),
  );
  expect(bytes).toEqual(encodeText(original));
  expect((await (await openGlobalSnippetFileStore()).read()).source).toBe(
    original,
  );
});

it("permits a missing global read without Web Locks but refuses to create an unlocked file", async () => {
  const getDirectoryHandle = vi.fn(async () => {
    throw new DOMException("Missing", "NotFoundError");
  });
  vi.stubGlobal("navigator", {
    storage: { getDirectory: async () => ({ getDirectoryHandle }) },
  });
  const store = await openGlobalSnippetFileStore(),
    snapshot = await store.read();
  expect(snapshot.status).toBe("missing");
  await expect(store.save(snapshot, original)).rejects.toThrow("Web Locks");
  expect(getDirectoryHandle).toHaveBeenCalledExactlyOnceWith("global", {
    create: false,
  });
});
