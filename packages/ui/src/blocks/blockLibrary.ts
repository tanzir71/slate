import type { CustomBlock } from "@slate/core";
import {
  createSpaceBlock,
  readSpaceBlock,
  readSpaceBlocks,
  saveSpaceBlock,
  type BrowserSpace,
  type BrowserWriteResult,
  type SpaceBlockFile,
} from "@slate/storage/browser-space";

export interface BlockLibrarySnapshot {
  readonly loading: boolean;
  readonly files: readonly SpaceBlockFile[];
  readonly blocks: readonly CustomBlock[];
  readonly error: string;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const sameFile = (a: SpaceBlockFile, b: SpaceBlockFile) =>
  b.status !== "unsupported" &&
  a.path === b.path &&
  a.status === b.status &&
  a.source === b.source &&
  a.error === b.error;

/** Refresh definitions outside key handlers; re-read only the explicitly chosen fragment. */
export function createBlockLibrary(
  space: BrowserSpace,
  canInsert: () => boolean,
  notify: () => void = () => undefined,
) {
  const listeners = new Set<() => void>();
  let generation = 0,
    disposed = false;
  let snapshot: BlockLibrarySnapshot = {
    loading: true,
    files: [],
    blocks: [],
    error: "",
  };
  function publish(next: BlockLibrarySnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function assertOpen() {
    if (disposed)
      throw new Error("This Space is closed. Choose the block again.");
  }
  async function refresh() {
    if (disposed) return;
    const current = ++generation;
    let files: SpaceBlockFile[];
    try {
      files = await readSpaceBlocks(space);
    } catch (cause) {
      if (current === generation && !disposed)
        publish({
          loading: false,
          files: [],
          blocks: [],
          error: message(cause),
        });
      return;
    }
    if (current !== generation || disposed) return;
    if (
      !snapshot.loading &&
      !snapshot.error &&
      files.length === snapshot.files.length &&
      files.every((file, index) => sameFile(snapshot.files[index]!, file))
    )
      return;
    const before = new Map(snapshot.blocks.map((block) => [block.id, block]));
    const blocks = files.flatMap(({ block }) => {
      if (!block) return [];
      const previous = before.get(block.id);
      return [previous?.source === block.source ? previous : block];
    });
    publish({ loading: false, files, blocks, error: "" });
  }
  async function committed(result: BrowserWriteResult) {
    try {
      notify();
    } catch {
      /* Advisory messages cannot undo a committed file. */
    }
    await refresh();
    return result;
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
    async resolve(id: string, previewSource?: string): Promise<CustomBlock> {
      assertOpen();
      if (!canInsert())
        throw new Error("This Space is read-only. Choose Use here to edit.");
      const selected = snapshot.blocks.find((block) => block.id === id);
      if (!selected)
        throw new Error(
          "This custom block is unavailable. Refresh and choose it again.",
        );
      if (previewSource !== undefined && previewSource !== selected.source)
        throw new Error(
          "This custom block changed. Review its preview and choose it again.",
        );
      const current = await readSpaceBlock(space, selected.path);
      assertOpen();
      if (!canInsert())
        throw new Error("This Space is read-only. Choose Use here to edit.");
      if (current.status !== "valid" || !current.block) {
        await refresh();
        throw new Error(
          current.error ??
            "This custom block was removed. Choose another block.",
        );
      }
      if (
        current.source !== selected.source ||
        snapshot.blocks.find((block) => block.id === id)?.source !==
          selected.source
      ) {
        await refresh();
        throw new Error(
          "This custom block changed. Review its preview and choose it again.",
        );
      }
      return current.block;
    },
    async create(name: string, source: string) {
      assertOpen();
      return committed(await createSpaceBlock(space, name, source));
    },
    async save(base: SpaceBlockFile, source: string) {
      assertOpen();
      return committed(await saveSpaceBlock(space, base, source));
    },
    dispose() {
      disposed = true;
      generation++;
      listeners.clear();
    },
  };
}
export type BlockLibrary = ReturnType<typeof createBlockLibrary>;
