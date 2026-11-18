import { describe, expect, it, vi } from "vitest";
import { createDirectoryFiles, encodeText, type BrowserDirectoryHandle } from "../src/browserFiles";

describe("directory file writes", () => {
  it.each(["getFile", "arrayBuffer"] as const)("reacquires a fresh snapshot once after NotReadableError in %s", async (where) => {
    const fresh = { size: 5, lastModified: 2, text: async () => "fresh", arrayBuffer: async () => new Uint8Array([102, 114, 101, 115, 104]).buffer };
    const stale = { ...fresh, arrayBuffer: async () => { throw new DOMException("Snapshot changed", "NotReadableError"); } };
    const getFile = vi.fn().mockResolvedValue(fresh);
    if (where === "getFile") getFile.mockRejectedValueOnce(new DOMException("Snapshot changed", "NotReadableError"));
    else getFile.mockResolvedValueOnce(stale);
    const createWritable = vi.fn();
    const root = { getFileHandle: vi.fn(async () => ({ getFile, createWritable })) } as unknown as BrowserDirectoryHandle;
    expect(Array.from((await createDirectoryFiles(root).read("note.md"))!)).toEqual([102, 114, 101, 115, 104]);
    expect(getFile).toHaveBeenCalledTimes(2);
    expect(root.getFileHandle).toHaveBeenCalledTimes(1);
    expect(createWritable).not.toHaveBeenCalled();
  });

  it("surfaces a repeated NotReadableError after exactly two fresh snapshots", async () => {
    const getFile = vi.fn().mockRejectedValueOnce(new DOMException("First snapshot", "NotReadableError")).mockRejectedValue(new DOMException("Still unreadable", "NotReadableError"));
    const root = { getFileHandle: async () => ({ getFile }) } as unknown as BrowserDirectoryHandle;
    await expect(createDirectoryFiles(root).read("note.md")).rejects.toThrow("Still unreadable");
    expect(getFile).toHaveBeenCalledTimes(2);
  });

  it("does not retry permission failures or other read errors", async () => {
    for (const name of ["NotAllowedError", "SecurityError", "UnknownError"]) {
      const getFile = vi.fn().mockRejectedValue(new DOMException("Read failed", name));
      const root = { getFileHandle: async () => ({ getFile }) } as unknown as BrowserDirectoryHandle;
      await expect(createDirectoryFiles(root).read("note.md")).rejects.toThrow("Read failed");
      expect(getFile).toHaveBeenCalledOnce();
    }
  });
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
