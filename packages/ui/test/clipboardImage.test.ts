import { expect, it, vi } from "vitest";
import { createMemoryFiles } from "@slate/storage/browser-files";
import { createBrowserSpace } from "@slate/storage/browser-space";
import { importClipboardImage } from "../src/browser/importClipboardImage";
import { importBlockImage } from "../src/browser/importBlockImage";

it("saves picked images beside nested sheets so their relative Markdown reference resolves", async () => {
  const files = createMemoryFiles();
  const result = await importBlockImage(
    createBrowserSpace(files),
    image(),
    "Drafts/Nested/Note.md",
  );
  expect(result.path).toBe("assets/diagram-v2.png");
  expect(await files.read("Drafts/Nested/assets/diagram-v2.png")).toEqual(png);
  expect(await files.read("assets/diagram-v2.png")).toBeUndefined();
});

// Opaque PNG payload: its bytes must pass through without decoding/re-encoding.
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
function image(bytes = png, name = "Diagram [v2].PNG", type = "image/png") {
  return { name, type, arrayBuffer: vi.fn(async () => bytes.slice().buffer) };
}
it("keeps exact PNG bytes beside the sheet and returns a portable relative reference", async () => {
  const files = createMemoryFiles();
  const result = await importClipboardImage(
    createBrowserSpace(files),
    image(),
    "Drafts/Note.md",
  );
  expect(result).toEqual({
    path: "./assets/diagram-v2-1.png",
    alt: "Diagram [v2]",
  });
  expect(await files.read("Drafts/assets/diagram-v2-1.png")).toEqual(png);
  expect(await files.read("assets/diagram-v2-1.png")).toBeUndefined();
});
it("preserves collisions and uses the next free number for the original image slug", async () => {
  const files = createMemoryFiles();
  await files.write("Drafts/assets/diagram-v2-1.png", new Uint8Array([9]));
  const result = await importClipboardImage(
    createBrowserSpace(files),
    image(),
    "Drafts/Note.md",
  );
  expect(result.path).toBe("./assets/diagram-v2-2.png");
  expect(await files.read("Drafts/assets/diagram-v2-1.png")).toEqual(
    new Uint8Array([9]),
  );
  expect(await files.read("Drafts/assets/diagram-v2-2.png")).toEqual(png);
});
it("keeps Unicode alt text and saves root-sheet images in the root assets folder", async () => {
  const files = createMemoryFiles();
  const result = await importClipboardImage(
    createBrowserSpace(files),
    image(png, "বাংলা.png"),
    "Note.md",
  );
  expect(result).toEqual({ path: "./assets/image-1.png", alt: "বাংলা" });
  expect(await files.read("assets/image-1.png")).toEqual(png);
});
it("stores actual encoded PNG bytes for other formats", async () => {
  const files = createMemoryFiles();
  const file = image(
    new Uint8Array([255, 216, 255]),
    "Photo.jpg",
    "image/jpeg",
  );
  const encode = vi.fn(async () => png);
  const result = await importClipboardImage(
    createBrowserSpace(files),
    file,
    "Note.md",
    encode,
  );
  expect(encode).toHaveBeenCalledExactlyOnceWith(file);
  expect(result.path).toBe("./assets/photo-1.png");
  expect(await files.read("assets/photo-1.png")).toEqual(png);
});
it("does not write on conversion, ownership or path failures", async () => {
  const files = createMemoryFiles();
  const file = image();
  await expect(
    importClipboardImage(createBrowserSpace(files), file, "../Note.md"),
  ).rejects.toThrow("Invalid workspace path");
  expect(file.arrayBuffer).not.toHaveBeenCalled();
  await expect(
    importClipboardImage(
      createBrowserSpace(files),
      file,
      "Note.md",
      async () => {
        throw new Error("Decode failed");
      },
    ),
  ).rejects.toThrow("Decode failed");
  await expect(
    importClipboardImage(
      createBrowserSpace(files, () => false),
      file,
      "Note.md",
    ),
  ).rejects.toThrow("read-only");
  expect(await files.list(true)).toEqual([]);
});
