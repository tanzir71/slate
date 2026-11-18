import { expect, it, vi } from "vitest";
import { convertClipboardHtml } from "../src/clipboardHtml";

const converter = vi.hoisted(() => ({
  initialized: vi.fn(),
  convert: vi.fn((html: string) => `converted:${html}`),
}));
vi.mock("../src/htmlToMarkdown.js", () => {
  converter.initialized();
  return { convertHtmlToMarkdown: converter.convert };
});
it("does not initialize the rich converter until the first clipboard request", async () => {
  expect(converter.initialized).not.toHaveBeenCalled();
  await expect(convertClipboardHtml("<p>First</p>")).resolves.toBe(
    "converted:<p>First</p>",
  );
  await expect(convertClipboardHtml("<p>Second</p>")).resolves.toBe(
    "converted:<p>Second</p>",
  );
  expect(converter.initialized).toHaveBeenCalledTimes(1);
  expect(converter.convert.mock.calls).toEqual([
    ["<p>First</p>"],
    ["<p>Second</p>"],
  ]);
});
