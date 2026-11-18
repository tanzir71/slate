import type { createBrowserSpace } from "@slate/storage/browser-space";
import { safeBrowserPath } from "@slate/storage/browser-files";

const imageExtensions: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

export async function importBlockImage(
  space: Pick<ReturnType<typeof createBrowserSpace>, "importFiles">,
  file: Pick<File, "type" | "name" | "arrayBuffer">,
  sheetPath?: string,
) {
  const safe = sheetPath === undefined ? "" : safeBrowserPath(sheetPath);
  const directory = safe.includes("/") ? safe.slice(0, safe.lastIndexOf("/") + 1) : "";
  const extension = imageExtensions[file.type];
  if (!extension)
    throw new Error(
      "Choose a PNG, JPEG, GIF, WebP, AVIF, SVG, BMP or TIFF image.",
    );
  const alt =
    file.name.replace(/\.[^.]+$/, "").replace(/[\r\n]/g, " ") || "Image";
  const name =
    alt
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "image";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const [saved] = await space.importFiles({
    [`${directory}assets/${name}.${extension}`]: bytes,
  });
  if (!saved) throw new Error("The image could not be saved. Try again.");
  return { path: saved.slice(directory.length), alt };
}
