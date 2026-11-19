import { expect, it, vi } from "vitest";
import { createMemoryFiles } from "../../storage/src/browserFiles";
import {
  createBrowserSpace,
  createSnippetFileStore,
  globalSnippetPath,
  spaceSnippetPath,
} from "../../storage/src/browserSpace";
import { createSnippetLibrary } from "../src/snippets/snippetLibrary";

const config = (snippets: unknown[]) =>
  JSON.stringify({ version: 1, snippets });
function library(
  local: Record<string, string> = {},
  global: Record<string, string> = {},
) {
  const localFiles = createMemoryFiles(local),
    globalFiles = createMemoryFiles(global);
  const globalStore = createSnippetFileStore(
    createBrowserSpace(globalFiles),
    globalSnippetPath,
    (action) => action(),
  );
  return {
    library: createSnippetLibrary(
      createBrowserSpace(localFiles),
      async () => globalStore,
    ),
    localFiles,
    globalFiles,
  };
}
it("loads shipped global defaults only for a missing file and an empty Space scope", async () => {
  const { library: source, globalFiles } = library();
  await source.refresh();
  expect(source.getSnapshot().snippets.map((entry) => entry.trigger)).toEqual([
    ";today",
    ";tbl",
    ";sig",
  ]);
  expect(await globalFiles.list(true)).toEqual([]);
  await globalFiles.write(
    globalSnippetPath,
    new TextEncoder().encode(config([])),
  );
  await source.refresh();
  expect(source.getSnapshot().snippets).toEqual([]);
});
it("applies exact Space overrides and disabled tombstones without writing during refresh", async () => {
  const { library: source, localFiles } = library({
    [spaceSnippetPath]: config([
      { trigger: ";today", body: "Local today" },
      { trigger: ";tbl", body: "", enabled: false },
    ]),
  });
  await source.refresh();
  expect(
    source.getSnapshot().snippets.map((entry) => [entry.trigger, entry.origin]),
  ).toEqual([
    [";today", "space"],
    [";sig", "global"],
  ]);
  expect(await localFiles.list(true)).toEqual([spaceSnippetPath]);
});
it("fails closed for malformed files and permits explicit source repair", async () => {
  const { library: source } = library({ [spaceSnippetPath]: "broken" });
  await source.refresh();
  expect(source.getSnapshot().snippets).toEqual([]);
  expect(source.getSnapshot().errors).toHaveLength(1);
  const saved = await source.save(
    "space",
    source.getSnapshot().space!,
    config([{ trigger: ";fixed", body: "Fixed" }]),
  );
  expect(saved.conflict).toBe(false);
  expect(source.getSnapshot().errors).toEqual([]);
  expect(source.getSnapshot().snippets.at(-1)?.trigger).toBe(";fixed");
});
it("reports unavailable global storage and retries opening it on a later refresh", async () => {
  const global = createSnippetFileStore(
    createBrowserSpace(createMemoryFiles()),
    globalSnippetPath,
    (action) => action(),
  );
  const open = vi
    .fn()
    .mockRejectedValueOnce(new Error("Storage unavailable"))
    .mockResolvedValue(global);
  const source = createSnippetLibrary(
    createBrowserSpace(createMemoryFiles()),
    open,
  );
  await source.refresh();
  expect(source.getSnapshot().snippets).toEqual([]);
  expect(source.getSnapshot().errors[0]).toContain("Storage unavailable");
  await source.refresh();
  expect(source.getSnapshot().snippets).toHaveLength(3);
  expect(open).toHaveBeenCalledTimes(2);
});
it("publishes fresh actual files after a save conflict rather than activating the conflict copy", async () => {
  const original = config([{ trigger: ";x", body: "Before" }]);
  const { library: source, localFiles } = library({
    [spaceSnippetPath]: original,
  });
  await source.refresh();
  const base = source.getSnapshot().space!;
  await localFiles.write(
    spaceSnippetPath,
    new TextEncoder().encode(config([{ trigger: ";x", body: "External" }])),
  );
  const result = await source.save(
    "space",
    base,
    config([{ trigger: ";x", body: "Local" }]),
  );
  expect(result.conflict).toBe(true);
  expect(
    source.getSnapshot().snippets.find((entry) => entry.trigger === ";x")?.body,
  ).toBe("External");
});
it("does not publish an obsolete refresh after a newer refresh or disposal", async () => {
  const files = createMemoryFiles(),
    space = createBrowserSpace(files),
    global = createSnippetFileStore(
      createBrowserSpace(createMemoryFiles()),
      globalSnippetPath,
      (action) => action(),
    );
  const source = createSnippetLibrary(space, async () => global);
  const read = vi.spyOn(files, "read"),
    notify = vi.fn();
  let release: (bytes: Uint8Array | undefined) => void = () => undefined;
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  source.subscribe(notify);
  const pending = source.refresh();
  await source.refresh();
  const newest = source.getSnapshot();
  release(new TextEncoder().encode("broken"));
  await pending;
  expect(source.getSnapshot()).toBe(newest);
  expect(notify).toHaveBeenCalledOnce();
  const disposed = source.refresh();
  source.dispose();
  await disposed;
  expect(source.getSnapshot()).toBe(newest);
});

it("keeps the cached index and snapshot stable when focus or a folder poll finds the same files", async () => {
  const { library: source } = library();
  await source.refresh();
  const previous = source.getSnapshot(),
    notify = vi.fn();
  source.subscribe(notify);
  await source.refresh();
  expect(source.getSnapshot()).toBe(previous);
  expect(source.getSnapshot().index).toBe(previous.index);
  expect(notify).not.toHaveBeenCalled();
});

it("revalidates explicit menu choices and rejects stale preview bodies and configuration errors", async () => {
  const { library: source, localFiles } = library({
    [spaceSnippetPath]: config([
      { trigger: ";menu", name: "Menu", body: "First" },
    ]),
  });
  await source.refresh();
  const preview = source
    .getSnapshot()
    .snippets.find((entry) => entry.trigger === ";menu")!;
  expect((await source.resolve(preview)).body).toBe("First");
  await localFiles.write(
    spaceSnippetPath,
    new TextEncoder().encode(
      config([{ trigger: ";menu", name: "Menu", body: "Second" }]),
    ),
  );
  await expect(source.resolve(preview)).rejects.toThrow("changed");
  await expect(source.resolve(preview)).rejects.toThrow("changed");
  const current = source
    .getSnapshot()
    .snippets.find((entry) => entry.trigger === ";menu")!;
  await localFiles.write(spaceSnippetPath, new TextEncoder().encode("{"));
  await expect(source.resolve(current)).rejects.toThrow();
  expect(source.getSnapshot().snippets).toEqual([]);
});
it("rejects menu resolution before or after ownership loss and after closing the Space", async () => {
  let owned = true;
  const localFiles = createMemoryFiles(),
    globalFiles = createMemoryFiles();
  const globalStore = createSnippetFileStore(
    createBrowserSpace(globalFiles),
    globalSnippetPath,
    (action) => action(),
  );
  const source = createSnippetLibrary(
    createBrowserSpace(localFiles),
    async () => globalStore,
    () => owned,
  );
  await source.refresh();
  const preview = source.getSnapshot().snippets[0]!;
  owned = false;
  const read = vi.spyOn(localFiles, "read");
  await expect(source.resolve(preview)).rejects.toThrow("read-only");
  expect(read).not.toHaveBeenCalled();
  owned = true;
  read.mockImplementationOnce(async () => {
    owned = false;
    return undefined;
  });
  await expect(source.resolve(preview)).rejects.toThrow("read-only");
  owned = true;
  source.dispose();
  await expect(source.resolve(preview)).rejects.toThrow("closed");
});
