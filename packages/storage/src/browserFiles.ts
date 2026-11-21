import { decodeText, encodeText, readMarkdownSnapshot, safeWorkspacePath as safeBrowserPath, type MutableWorkspaceFiles } from "./fileIO";
import { isFileError, listDirectoryPaths, locateDirectoryFile, readDirectoryFile } from "./browserDirectoryReads";
import { createDirectorySnapshotReader } from "./browserSnapshotClient";
export { decodeText, encodeText, safeBrowserPath };

/** File operations shared by user-selected directories and OPFS libraries. */
export interface BrowserFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<Pick<File, "text" | "arrayBuffer" | "size" | "lastModified">>;
  createWritable(): Promise<{
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

export interface BrowserDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  entries(): AsyncIterableIterator<[string, BrowserDirectoryHandle | BrowserFileHandle]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<BrowserDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileHandle>;
  removeEntry(name: string): Promise<void>;
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
}

export type BrowserFiles = MutableWorkspaceFiles;

export function createDirectoryFiles(root: BrowserDirectoryHandle): BrowserFiles {
  const locate = (path: string, create: boolean) => locateDirectoryFile(root, path, create);
  const list = (includePrivate = false) => listDirectoryPaths(root, "", includePrivate);
  const read = (path: string) => readDirectoryFile(root, path);
  return {
    list, read,
    snapshotMarkdown: createDirectorySnapshotReader(root, () => readMarkdownSnapshot({ list, read })),
    async listDirectory(path) {
      const target = safeBrowserPath(path);
      let directory = root;
      try {
        for (const part of target.split("/")) directory = await directory.getDirectoryHandle(part, { create: false });
      } catch (cause) {
        if (isFileError(cause, "NotFoundError") || isFileError(cause, "TypeMismatchError")) return [];
        throw cause;
      }
      return listDirectoryPaths(directory, `${target}/`, true);
    },
    async write(path, bytes) {
      const { directory, name } = await locate(path, true);
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
    },
    async remove(path) {
      const { directory, name } = await locate(path, false);
      await directory.removeEntry(name);
    }
  };
}

export function createMemoryFiles(initial: Record<string, string> = {}): BrowserFiles {
  const files = new Map(Object.entries(initial).map(([path, content]) => [safeBrowserPath(path), encodeText(content)]));
  return {
    async list(includePrivate = false) {
      return [...files.keys()].filter((path) => includePrivate || !path.startsWith(".slate/")).sort();
    },
    async read(path) { return files.get(safeBrowserPath(path))?.slice(); },
    async write(path, bytes) { files.set(safeBrowserPath(path), bytes.slice()); },
    async remove(path) {
      if (!files.delete(safeBrowserPath(path))) throw new DOMException("File not found", "NotFoundError");
    }
  };
}
