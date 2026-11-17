import { safeBrowserPath } from "./browserFiles";

export interface BrowserImportFile { path: string; file: File }

export function addBrowserImportEntry(entries: Record<string, Uint8Array>, path: string, bytes: Uint8Array): void {
  safeBrowserPath(path);
  let candidate = path;
  let suffix = 1;
  while (Object.hasOwn(entries, candidate)) candidate = path.replace(/(\.[^/.]+)?$/, ` (${suffix++})$1`);
  Object.defineProperty(entries, candidate, { value: bytes, enumerable: true, configurable: true });
}

/** Directory readers can return many batches; stopping after the first silently loses files. */
export async function collectBrowserDrop(data: Pick<DataTransfer, "items" | "files">): Promise<BrowserImportFile[]> {
  const result: BrowserImportFile[] = [];
  async function walk(entry: FileSystemEntry, prefix = "") {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      result.push({ path: `${prefix}${entry.name}`, file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!entries.length) break;
        for (const child of entries) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  }
  // Capture entries synchronously; drag data can disappear after the drop event returns.
  const entries = Array.from(data.items).filter((item) => item.kind === "file").map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));
  if (entries.length) {
    for (const { entry, file } of entries) {
      if (entry) await walk(entry);
      else if (file) result.push({ path: file.name, file });
    }
  } else {
    for (const file of Array.from(data.files)) result.push({ path: file.webkitRelativePath || file.name, file });
  }
  return result;
}
