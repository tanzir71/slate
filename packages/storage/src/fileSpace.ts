import { decodeText, encodeText, safeWorkspacePath as safeBrowserPath, type WorkspaceFiles } from "./fileIO";

export interface FileSheet { path: string; content: string; unsupportedEncoding?: boolean }
export interface FileWriteResult extends FileSheet { conflict: boolean }

const decodeFile = (path: string, bytes: Uint8Array): string => decodeText(bytes, /\.md$/i.test(path));

function sameBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  return left === right || (left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => value === right[index]));
}

/** All mutations are serialized; callers supply their last disk content for optimistic concurrency. */
export function createFileSpace(files: WorkspaceFiles, canWrite: () => boolean = () => true) {
  let pending: Promise<unknown> = Promise.resolve();
  const read = async (path: string) => {
    const bytes = await files.read(safeBrowserPath(path));
    return bytes === undefined ? undefined : decodeFile(path, bytes);
  };
  function mutate<T>(action: () => Promise<T>): Promise<T> {
    const next = pending.then(async () => {
      if (!canWrite()) throw new Error("This Space is read-only. Choose Use here to edit.");
      return action();
    });
    pending = next.catch(() => undefined);
    return next;
  }
  async function tryCreate(path: string, bytes: Uint8Array): Promise<boolean> {
    const target = safeBrowserPath(path);
    if ("operations" in files) return files.operations.createNew(target, bytes);
    if (await files.read(target) !== undefined) return false;
    await files.write(target, bytes);
    return true;
  }
  async function writeNew(path: string, bytes: Uint8Array): Promise<string> {
    safeBrowserPath(path);
    let candidate = path, suffix = 1;
    while (!await tryCreate(candidate, bytes)) candidate = path.replace(/(\.[^/.]+)?$/, ` (${suffix++})$1`);
    return candidate;
  }
  async function writeConflict(path: string, content: string): Promise<FileWriteResult> {
    const conflictPath = path.replace(/(\.[^/.]+)?$/, ` (conflicted copy ${new Date().toISOString().replaceAll(/[:.]/g, "-")})$1`);
    return { path: await writeNew(conflictPath, encodeText(content)), content, conflict: true };
  }
  return {
    files,
    read,
    flush: () => pending,
    async sheets(): Promise<FileSheet[]> {
      const paths = (await files.list()).filter((path) => /\.md$/i.test(path));
      const rows = await Promise.all(paths.map(async (path): Promise<FileSheet | undefined> => {
        const bytes = await files.read(path);
        if (bytes === undefined) return undefined;
        try { return { path, content: decodeFile(path, bytes) }; }
        catch { return { path, content: "", unsupportedEncoding: true }; }
      }));
      return rows.filter((row): row is FileSheet => row !== undefined);
    },
    create(path: string, content: string): Promise<FileSheet> {
      return mutate(async () => ({ path: await writeNew(path, encodeText(content)), content }));
    },
    /** A canonical daily path is checked inside the mutation queue, including empty/unknown encodings. */
    createIfMissing(path: string, content: string): Promise<FileSheet | undefined> {
      const target = safeBrowserPath(path);
      return mutate(async () => {
        if (!await tryCreate(target, encodeText(content))) return;
        return { path: target, content };
      });
    },
    save(path: string, content: string, baseContent: string | undefined): Promise<FileWriteResult> {
      return mutate(async () => {
        const bytes = await files.read(safeBrowserPath(path));
        let disk: string | undefined;
        try { disk = bytes === undefined ? undefined : decodeFile(path, bytes); }
        catch { return writeConflict(path, content); }
        if (disk !== baseContent && disk !== content) return writeConflict(path, content);
        if ("operations" in files) return { ...await files.operations.save(path, encodeText(content), bytes), content };
        await files.write(path, encodeText(content));
        return { path, content, conflict: false };
      });
    },
    /** Private Markdown/configuration edits may retain a file BOM and compare exact disk bytes. */
    saveSnapshot(path: string, content: string, baseBytes: Uint8Array | undefined): Promise<FileWriteResult> {
      const base = baseBytes?.slice(), proposed = encodeText(content);
      return mutate(async () => {
        const target = safeBrowserPath(path), disk = await files.read(target);
        if (!sameBytes(disk, base) && !sameBytes(disk, proposed)) return writeConflict(target, content);
        if ("operations" in files) return { ...await files.operations.save(target, proposed, disk), content };
        await files.write(target, proposed);
        return { path: target, content, conflict: false };
      });
    },
    move(from: string, to: string, baseContent: string): Promise<FileSheet> {
      return mutate(async () => {
        safeBrowserPath(from); safeBrowserPath(to);
        const bytes = await files.read(from);
        if (!bytes || decodeFile(from, bytes) !== baseContent) throw new Error("File changed outside Slate. Refresh before moving it.");
        if ("operations" in files) {
          await files.operations.move(safeBrowserPath(from), safeBrowserPath(to), bytes);
          return { path: to, content: baseContent };
        }
        if (await files.read(to)) throw new Error("A file already exists at the destination.");
        await files.write(safeBrowserPath(to), bytes);
        // A concurrent external edit is preserved in the source, even after copying the destination.
        if ((await read(from)) !== baseContent) throw new Error("Source changed during move. Both copies have been kept.");
        await files.remove(from);
        return { path: to, content: baseContent };
      });
    },
    trash(path: string, baseContent: string): Promise<string> {
      return mutate(async () => {
        const destination = `.slate/trash/${Date.now()}/${safeBrowserPath(path)}`;
        const bytes = await files.read(path);
        if (!bytes) throw new Error("File no longer exists.");
        if (decodeFile(path, bytes) !== baseContent) throw new Error("File changed outside Slate. Refresh before deleting it.");
        if ("operations" in files) return files.operations.trash(safeBrowserPath(path), bytes);
        const target = await writeNew(destination, bytes);
        if ((await read(path)) !== baseContent) throw new Error("File changed during deletion. The original and trash copy have been kept.");
        await files.remove(path);
        return target;
      });
    },
    async importNumberedFile(path: string, bytes: Uint8Array): Promise<string> {
      const safe = safeBrowserPath(path);
      const snapshot = bytes.slice();
      const dot = safe.lastIndexOf(".");
      const split = dot > safe.lastIndexOf("/") + 1 ? dot : safe.length;
      const stem = safe.slice(0, split), extension = safe.slice(split);
      return mutate(async () => {
        let number = 1, target = `${stem}-${number}${extension}`;
        while (!await tryCreate(target, snapshot))
          target = `${stem}-${++number}${extension}`;
        return target;
      });
    },
    importFiles(entries: Record<string, Uint8Array>): Promise<string[]> {
      return mutate(async () => {
        // Validate every path before writing anything. Imported configuration never replaces existing configuration.
        Object.keys(entries).forEach(safeBrowserPath);
        const imported: string[] = [];
        for (const [path, bytes] of Object.entries(entries)) imported.push(await writeNew(path, bytes));
        return imported;
      });
    }
  };
}

export type FileSpace = ReturnType<typeof createFileSpace>;
