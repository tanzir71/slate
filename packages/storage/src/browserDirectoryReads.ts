import { safeWorkspacePath } from "./fileIO";
import type { BrowserDirectoryHandle } from "./browserFiles";

export function isFileError(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === name;
}

export async function locateDirectoryFile(root: BrowserDirectoryHandle, path: string, create: boolean) {
  const parts = safeWorkspacePath(path).split("/"), name = parts.pop()!;
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
  return { directory, name };
}

export async function listDirectoryPaths(directory: BrowserDirectoryHandle, prefix = "", includePrivate = false): Promise<string[]> {
  const paths: string[] = [];
  async function walk(directory: BrowserDirectoryHandle, prefix: string) {
    for await (const [name, entry] of directory.entries()) {
      if (!includePrivate && name === ".slate") continue;
      const path = safeWorkspacePath(`${prefix}${name}`);
      if (entry.kind === "directory") await walk(entry, `${path}/`);
      else paths.push(path);
    }
  }
  await walk(directory, prefix);
  return paths.sort();
}

export async function readDirectoryFile(root: BrowserDirectoryHandle, path: string): Promise<Uint8Array | undefined> {
  try {
    const { directory, name } = await locateDirectoryFile(root, path, false);
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
}
