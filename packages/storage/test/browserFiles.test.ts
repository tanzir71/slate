import { describe, expect, it, vi } from "vitest";
import { createDirectoryFiles, encodeText, type BrowserDirectoryHandle } from "../src/browserFiles";

describe("directory file writes", () => {
  it("aborts a failed writable stream and surfaces permission errors", async () => {
    const abort = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const root = {
      getFileHandle: vi.fn(async () => ({ createWritable: async () => ({
        write: async () => { throw new Error("Disk full"); }, abort, close
      }) }))
    } as unknown as BrowserDirectoryHandle;
    await expect(createDirectoryFiles(root).write("note.md", encodeText("words"))).rejects.toThrow("Disk full");
    expect(abort).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    root.getFileHandle = vi.fn(async () => { throw new DOMException("Denied", "NotAllowedError"); });
    await expect(createDirectoryFiles(root).read("note.md")).rejects.toThrow("Denied");
  });

  it("returns undefined only for missing files", async () => {
    const root = {
      getFileHandle: async () => { throw new DOMException("Missing", "NotFoundError"); }
    } as unknown as BrowserDirectoryHandle;
    expect(await createDirectoryFiles(root).read("note.md")).toBeUndefined();
  });
});
