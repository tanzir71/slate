import { safeWorkspacePath, type WorkspaceFileReader } from "@slate/storage/file-io";

/** Decode URL escapes once, then resolve only inside this note's workspace. */
export function imageAssetPath(sheet: string, destination: string): string | undefined {
  let url: string;
  try { url = decodeURIComponent(destination.split(/[?#]/, 1)[0]!); safeWorkspacePath(sheet); }
  catch { return undefined; }
  if (!url || url.startsWith("/") || /[:\\]/.test(url)) return undefined;
  for (const character of url) if (character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) return undefined;
  const parts = sheet.split("/").slice(0, -1);
  for (const part of url.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return undefined; parts.pop(); }
    else parts.push(part);
  }
  try { return safeWorkspacePath(parts.join("/")); } catch { return undefined; }
}

const mimeTypes: Readonly<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp", tiff: "image/tiff", tif: "image/tiff" };
export async function loadNoteImage(files: Pick<WorkspaceFileReader, "read">, sheet: string, destination: string, signal: AbortSignal): Promise<Blob | undefined> {
  signal.throwIfAborted();
  const path = imageAssetPath(sheet, destination), type = path && mimeTypes[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
  if (!path || !type) return undefined;
  const bytes = await files.read(path);
  signal.throwIfAborted();
  return bytes === undefined ? undefined : new Blob([bytes.slice().buffer], { type });
}
