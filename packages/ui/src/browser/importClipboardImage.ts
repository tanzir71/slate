import type { NumberedAssetWriter } from "../tauriAssets";
import { safeBrowserPath } from "@slate/storage/browser-files";
import {
  clipboardPng,
  type ClipboardImageFile,
  type PngEncoder,
} from "./clipboardPng";
export type { ClipboardImageFile, PngEncoder } from "./clipboardPng";
export async function importClipboardImage(
  space: NumberedAssetWriter,
  file: ClipboardImageFile,
  sheetPath: string,
  encode: PngEncoder = clipboardPng,
): Promise<{ path: string; alt: string }> {
  const safe = safeBrowserPath(sheetPath);
  const directory = safe.includes("/")
    ? safe.slice(0, safe.lastIndexOf("/") + 1)
    : "";
  const alt =
    file.name.replace(/\.[^.]*$/, "").replace(/[\r\n]/g, " ") || "Image";
  const slug =
    alt
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "image";
  const bytes = await encode(file);
  const saved = await space.importNumberedFile(
    directory + "assets/" + slug + ".png",
    bytes,
  );
  return { path: "./" + saved.slice(directory.length), alt };
}
