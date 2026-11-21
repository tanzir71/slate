import { expect, it, vi } from "vitest";
import { imageAssetPath, loadNoteImage } from "../src/browser/previewImage";

it.each([
  ["Inbox/Note.md", "./assets/diagram-1.png", "Inbox/assets/diagram-1.png"],
  ["Note.md", "assets/a.png", "assets/a.png"],
  ["Research/Inbox/Note.md", "../images/one.png", "Research/images/one.png"],
  ["Research/Note.md", "../one.png", "one.png"],
  ["Inbox/Note.md", "a%20b.png", "Inbox/a b.png"],
  ["Inbox/Note.md", "%E6%BC%A2.png", "Inbox/漢.png"],
  ["Inbox/Note.md", "a%23draft.png#fragment", "Inbox/a#draft.png"],
  ["Inbox/Note.md", "a%3Fdraft.png?size=2", "Inbox/a?draft.png"],
  ["Inbox/Note.md", "a%2520b.png", "Inbox/a%20b.png"],
  ["Inbox/Note.md", "a.png?size=2#preview", "Inbox/a.png"],
])("resolves a relative image inside its note's workspace: %s %s", (sheet, destination, expected) => {
  expect(imageAssetPath(sheet!, destination!)).toBe(expected);
});

it.each(["https://example.com/a.png", "//example.com/a.png", "/etc/a.png", "C:/a.png", "file:///a.png", "data:image/png,xxx", "javascript:alert(1)", "\\server\\a.png", "a\\..\\b.png", "../../a.png", "%2e%2e/%2e%2e/a.png", "%2Fetc/a.png", "java%73cript:alert(1)", "a%00.png", "a%0A.png", "a%7F.png", "a%zz.png", "", "#image", "?image"])("keeps an invalid or external destination out of workspace reads: %j", async destination => {
  const read = vi.fn();
  expect(imageAssetPath("Inbox/Note.md", destination)).toBeUndefined();
  expect(await loadNoteImage({ read }, "Inbox/Note.md", destination, new AbortController().signal)).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});

it.each([["png", "image/png"], ["JPG", "image/jpeg"], ["jpeg", "image/jpeg"], ["svg", "image/svg+xml"], ["avif", "image/avif"], ["gif", "image/gif"], ["bmp", "image/bmp"], ["tiff", "image/tiff"], ["webp", "image/webp"]])("loads %s through the existing file reader with its image MIME type", async (extension, type) => {
  const bytes = new Uint8Array([0, 255, 128, 10, 42]), read = vi.fn(async () => bytes);
  const blob = await loadNoteImage({ read }, "Drafts/Note.md", `./assets/a.${extension}`, new AbortController().signal);
  expect(read).toHaveBeenCalledExactlyOnceWith(`Drafts/assets/a.${extension}`);
  expect(blob).toBeInstanceOf(Blob); expect(blob!.type).toBe(type); expect(blob!.size).toBe(bytes.length);
  expect(bytes).toEqual(new Uint8Array([0, 255, 128, 10, 42]));
});

it("does not read non-image files, and keeps missing images unavailable", async () => {
  const read = vi.fn(async () => undefined), signal = new AbortController().signal;
  expect(await loadNoteImage({ read }, "Inbox/Note.md", "../secrets.txt", signal)).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
  expect(await loadNoteImage({ read }, "Inbox/Note.md", "missing.png", signal)).toBeUndefined();
  expect(read).toHaveBeenCalledExactlyOnceWith("Inbox/missing.png");
});

it("stops before a cancelled read and discards bytes that arrive after cancellation", async () => {
  const controller = new AbortController(), read = vi.fn(async () => new Uint8Array([1]));
  controller.abort();
  await expect(loadNoteImage({ read }, "Inbox/Note.md", "a.png", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(read).not.toHaveBeenCalled();
  const pending = new AbortController();
  const delayed = vi.fn(async () => { pending.abort(); return new Uint8Array([1]); });
  await expect(loadNoteImage({ read: delayed }, "Inbox/Note.md", "a.png", pending.signal)).rejects.toMatchObject({ name: "AbortError" });
});
