export type ClipboardImageFile = Pick<File, "name" | "type" | "arrayBuffer">;
export type PngEncoder = (file: ClipboardImageFile) => Promise<Uint8Array>;

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const;

/** Keep existing PNG bytes; decode other clipboard formats as a local image. */
export async function clipboardPng(
  file: ClipboardImageFile,
): Promise<Uint8Array> {
  const source = await file.arrayBuffer();
  const bytes = new Uint8Array(source);
  if (pngSignature.every((byte, index) => bytes[index] === byte)) return bytes;
  const url = URL.createObjectURL(new Blob([source], { type: file.type }));
  try {
    // Image documents disable SVG scripts and external resources. Never attach
    // copied SVG markup as a live document or fetch remote clipboard image URLs.
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("The clipboard image could not be decoded.");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not convert the image.");
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("The image could not be converted to PNG.")),
        "image/png",
      );
    });
    if (png.type !== "image/png")
      throw new Error("The browser did not provide a PNG image.");
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
