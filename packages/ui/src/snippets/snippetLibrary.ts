import {
  createSnippetIndex,
  readSnippetConfiguration,
  resolveSnippets,
  type ScopedSnippet,
} from "@slate/core";
import {
  createSnippetFileStore,
  globalSnippetPath,
  type BrowserSpace,
  type SnippetFile,
} from "@slate/storage/browser-space";
import { openGlobalSnippetFileStore } from "@slate/storage/browser-catalog";

export const builtinSnippets = readSnippetConfiguration({
  version: 1,
  snippets: [
    {
      trigger: ";today",
      name: "Today's heading",
      body: "## {{date:dddd, D MMM}}\n- [ ] {{cursor}}",
    },
    {
      trigger: ";tbl",
      name: "3 × 3 table",
      body: "| ${1:Column 1} | ${2:Column 2} | ${3:Column 3} |\n| --- | --- | --- |\n| ${4} | ${5} | ${6} |\n| ${7} | ${8} | ${9} |\n$0",
    },
    {
      trigger: ";sig",
      name: "Signature",
      body: "— ${1:Your name} · {{date:YYYY}}$0",
    },
  ],
});
const empty = readSnippetConfiguration({ version: 1, snippets: [] });
export type SnippetScope = "global" | "space";
export interface SnippetLibrarySnapshot {
  readonly loading: boolean;
  readonly global: SnippetFile | undefined;
  readonly space: SnippetFile | undefined;
  readonly snippets: readonly ScopedSnippet[];
  readonly index: ReturnType<typeof createSnippetIndex>;
  readonly errors: readonly string[];
}
type FileStore = ReturnType<typeof createSnippetFileStore>;
const failure = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** The current file snapshots and cached index change together, never during a keystroke. */
export function createSnippetLibrary(
  space: BrowserSpace,
  openGlobal: () => Promise<FileStore> = openGlobalSnippetFileStore,
) {
  const local = createSnippetFileStore(space),
    listeners = new Set<() => void>();
  let global: Promise<FileStore> | undefined,
    generation = 0;
  let snapshot: SnippetLibrarySnapshot = {
    loading: true,
    global: undefined,
    space: undefined,
    snippets: [],
    index: createSnippetIndex([]),
    errors: [],
  };
  const globalStore = () =>
    (global ??= Promise.resolve()
      .then(openGlobal)
      .catch((error: unknown) => {
        global = undefined;
        throw error;
      }));
  const publish = (next: SnippetLibrarySnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const unchanged = (before: SnippetFile | undefined, after: SnippetFile) =>
    before &&
    after.status !== "unsupported" &&
    before.status === after.status &&
    before.source === after.source &&
    before.error === after.error;
  async function refresh() {
    const current = ++generation;
    const [globalFile, spaceFile] = await Promise.all([
      globalStore()
        .then((store) => store.read())
        .catch((error: unknown): SnippetFile => ({
          path: globalSnippetPath,
          status: "unavailable",
          error: failure(error),
        })),
      local.read(),
    ]);
    if (current !== generation) return;
    if (
      !snapshot.loading &&
      unchanged(snapshot.global, globalFile) &&
      unchanged(snapshot.space, spaceFile)
    )
      return;
    const errors = [globalFile, spaceFile].flatMap((file) =>
      file.error ? [`${file.path}: ${file.error}`] : [],
    );
    const snippets = errors.length
      ? []
      : resolveSnippets(
          globalFile.configuration ?? builtinSnippets,
          spaceFile.configuration ?? empty,
        );
    publish({
      loading: false,
      global: globalFile,
      space: spaceFile,
      snippets,
      index: createSnippetIndex(snippets),
      errors,
    });
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    async save(scope: SnippetScope, base: SnippetFile, source: string) {
      const store = scope === "global" ? await globalStore() : local;
      const result = await store.save(base, source);
      await refresh();
      return result;
    },
    dispose() {
      generation++;
      listeners.clear();
    },
  };
}
export type SnippetLibrary = ReturnType<typeof createSnippetLibrary>;
