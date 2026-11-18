import { afterEach, expect, it, vi } from "vitest";
import {
  prepareClipboardImages,
  type ClipboardImageReference,
} from "../src/clipboardImages";
import { convertHtmlToMarkdown } from "../src/htmlToMarkdown";

afterEach(() => {
  vi.restoreAllMocks();
});
function contents(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
const data = "data:image/png;base64,AP+A";
function images(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return Array.from(template.content.querySelectorAll("img"));
}
it("uses attached image pixels in rich HTML without dropping text or adding a duplicate image", async () => {
  const file = new File(["pixels"], "image.png", { type: "image/png" });
  const save = vi.fn(async () => ({
    path: "./assets/image-1.png",
    alt: "File",
  }));
  const prepared = await prepareClipboardImages(
    '<p>Before</p><img src="https://external.test/image.png" alt="Picture"><p>After</p>',
    [file],
    save,
  );
  expect(save).toHaveBeenCalledExactlyOnceWith(file);
  expect(prepared.extra).toEqual([]);
  expect(prepared.embedded).toEqual([
    { path: "./assets/image-1.png", alt: "Picture" },
  ]);
  expect(convertHtmlToMarkdown(prepared.html)).toBe(
    "Before\n\n![Picture](./assets/image-1.png)\n\nAfter",
  );
});
it.each([
  ["data:image/png;base64,AP+A", [0, 255, 128], "image/png"],
  ["data:image/png,%00%FF%80", [0, 255, 128], "image/png"],
  ["data:image/png;base64,AP%2BA", [0, 255, 128], "image/png"],
  [
    "data:image/svg+xml,%3Csvg%3E%E0%A6%AC%E0%A6%BE%E0%A6%82%E0%A6%B2%E0%A6%BE%3C%2Fsvg%3E",
    Array.from(new TextEncoder().encode("<svg>বাংলা</svg>")),
    "image/svg+xml",
  ],
])(
  "decodes embedded pixels locally without fetch: %s",
  async (src, expected, type) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const save = vi.fn(async (file: File) => {
      expect(Array.from(await contents(file))).toEqual(expected);
      expect(file.type).toBe(type);
      return { path: "./assets/picture-1.png", alt: "Picture" };
    });
    const prepared = await prepareClipboardImages(
      '<img alt="Picture" src="' + src + '">',
      [],
      save,
    );
    expect(images(prepared.html)[0]?.getAttribute("src")).toBe(
      "./assets/picture-1.png",
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("copies repeated embedded sources once and preserves each occurrence's own alt text", async () => {
  const save = vi.fn(async () => ({
    path: "./assets/image-1.png",
    alt: "File",
  }));
  const prepared = await prepareClipboardImages(
    '<img src="' + data + '" alt="First"><img src="' + data + '" alt="Second">',
    [],
    save,
  );
  expect(save).toHaveBeenCalledTimes(1);
  expect(
    images(prepared.html).map((image) => image.getAttribute("alt")),
  ).toEqual(["First", "Second"]);
  expect(prepared.embedded).toEqual([
    { path: "./assets/image-1.png", alt: "First" },
    { path: "./assets/image-1.png", alt: "Second" },
  ]);
});
it("keeps every unmatched attached image alongside copied rich text", async () => {
  const first = new File(["1"], "first.png", { type: "image/png" });
  const second = new File(["2"], "second.png", { type: "image/png" });
  const save = vi.fn(async (file: File) => ({
    path: "./assets/" + file.name,
    alt: file.name,
  }));
  const prepared = await prepareClipboardImages(
    "<p>Words</p>",
    [first, second],
    save,
  );
  expect(convertHtmlToMarkdown(prepared.html)).toBe("Words");
  expect(prepared.embedded).toEqual([]);
  expect(prepared.extra).toEqual([
    { path: "./assets/first.png", alt: "first.png" },
    { path: "./assets/second.png", alt: "second.png" },
  ]);
});
it("never downloads external image references and only processes the selected fragment", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const save = vi.fn(async () => ({ path: "./assets/image-1.png" }));
  const prepared = await prepareClipboardImages(
    '<img src="' +
      data +
      '" alt="Outside"><!--StartFragment--><p>Kept</p><img src="https://external.test/remote.png" alt="Remote"><!--EndFragment-->',
    [],
    save,
  );
  expect(save).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(prepared.html).not.toContain("Outside");
  expect(prepared.html).toContain("https://external.test/remote.png");
});
it("keeps successful copies across retries and allows a failed import to retry", async () => {
  const cache = new Map<string, Promise<ClipboardImageReference>>();
  const save = vi
    .fn<(file: File) => Promise<ClipboardImageReference>>()
    .mockRejectedValueOnce(new Error("No write"))
    .mockResolvedValue({ path: "./assets/image-1.png" });
  const html = '<img src="' + data + '">';
  await expect(prepareClipboardImages(html, [], save, cache)).rejects.toThrow(
    "No write",
  );
  await prepareClipboardImages(html, [], save, cache);
  await prepareClipboardImages(html, [], save, cache);
  expect(save).toHaveBeenCalledTimes(2);
});
