import { safeWorkspacePath as safeBrowserPath, type WorkspaceFileReader } from "./fileIO";

export async function exportBrowserArchive(files: WorkspaceFileReader): Promise<Uint8Array> {
  const { zip } = await import("fflate");
  const entries: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const path of await files.list(true)) {
    const bytes = await files.read(path);
    if (bytes) entries[safeBrowserPath(path)] = bytes;
  }
  return new Promise((resolve, reject) => zip(entries, { level: 6 }, (error, data) => error ? reject(error) : resolve(data)));
}

export async function readBrowserArchive(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  const { unzip } = await import("fflate");
  let advertisedSize = 0;
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, { filter: (file) => {
      // Bound decompression before allocating output, including hostile zip bombs.
      if (file.originalSize > 100 * 1024 * 1024) throw new Error("An imported file exceeds 100 MB.");
      advertisedSize += file.originalSize;
      if (advertisedSize > 500 * 1024 * 1024) throw new Error("The imported Space exceeds 500 MB.");
      return !file.name.endsWith("/");
    } }, (error, data) => error ? reject(error) : resolve(data));
  });
  const normalized: Record<string, Uint8Array> = {};
  let total = 0;
  for (const [path, data] of Object.entries(entries)) {
    total += data.length;
    if (total > 500 * 1024 * 1024) throw new Error("The imported Space exceeds 500 MB.");
    const safe = safeBrowserPath(path);
    if (Object.hasOwn(normalized, safe)) throw new Error("Duplicate paths in archive.");
    Object.defineProperty(normalized, safe, { value: data, enumerable: true });
  }
  return normalized;
}
