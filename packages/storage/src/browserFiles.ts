import { decodeText, encodeText, safeWorkspacePath as safeBrowserPath, type MutableWorkspaceFiles } from "./fileIO";
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
  async function locate(path: string, create: boolean) {
    const parts = safeBrowserPath(path).split("/");
    const name = parts.pop()!;
    let directory = root;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
    return { directory, name };
  }

  return {
    async list(includePrivate = false) {
      const paths: string[] = [];
      async function walk(directory: BrowserDirectoryHandle, prefix: string) {
        for await (const [name, entry] of directory.entries()) {
          if (!includePrivate && name === ".slate") continue;
          const path = safeBrowserPath(`${prefix}${name}`);
          if (entry.kind === "directory") await walk(entry, `${path}/`);
          else paths.push(path);
        }
      }
      await walk(root, "");
      return paths.sort();
    },
    async read(path) {
      try {
        const { directory, name } = await locate(path, false);
        const handle = await directory.getFileHandle(name);
        const snapshot = async () => new Uint8Array(await (await handle.getFile()).arrayBuffer());
        try { return await snapshot(); }
        catch (error) {
          // A concurrent save can invalidate a File object. Obtain a fresh object once.
          if (!isFileError(error, "NotReadableError")) throw error;
          return await snapshot();
        }
      } catch (error) {
        if (isFileError(error, "NotFoundError")) return undefined;
        throw error;
      }
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

function isFileError(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === name;
}
