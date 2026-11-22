import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { libraryFile, libraryFileMatches } from "../../../e2e/libraryFiles";

const bytes = new TextEncoder().encode("\ufeff# Current\r\nবাংলা words.\r\n");
const stream = { write: vi.fn(async (_value: string | Uint8Array) => {}), close: vi.fn(async () => {}) };
const handle = { getFile: vi.fn(), createWritable: vi.fn(async () => stream) };
interface ProbeDirectory { getDirectoryHandle(): Promise<ProbeDirectory>; getFileHandle(): Promise<typeof handle> }
// Run the actual serialized callback against an isolated File System Access fixture.
const page = { evaluate: async <R, A>(callback: (arg: A) => R, arg: A): Promise<Awaited<R>> => await callback(arg) } as unknown as Page;
beforeEach(() => {
  vi.resetAllMocks();
  location.hash = "#/space/fixture";
  const directory: ProbeDirectory = { getDirectoryHandle: vi.fn(async () => directory), getFileHandle: vi.fn(async () => handle) };
  vi.stubGlobal("navigator", { storage: { getDirectory: vi.fn(async () => directory) } });
  handle.getFile.mockResolvedValue({ arrayBuffer: async () => bytes.buffer });
  handle.createWritable.mockResolvedValue(stream);
  stream.write.mockResolvedValue(); stream.close.mockResolvedValue();
});
afterEach(() => { vi.unstubAllGlobals(); });

it("lets a read-only byte poll reacquire a replaced File without changing the exact-byte expectation", async () => {
  handle.getFile.mockResolvedValueOnce({ arrayBuffer: async () => { throw new DOMException("File changed after acquisition", "NotReadableError"); } });
  expect(await libraryFile(page, "alpha.md")).toBeUndefined();
  expect(await libraryFile(page, "alpha.md")).toEqual(Array.from(bytes));
  expect(handle.getFile).toHaveBeenCalledTimes(2); expect(handle.createWritable).not.toHaveBeenCalled();
});
it("treats a replaced File as a nonmatching sample for the large-file comparison too", async () => {
  handle.getFile.mockResolvedValueOnce({ arrayBuffer: async () => { throw new DOMException("File changed after acquisition", "NotReadableError"); } });
  const expected = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  expect(await libraryFileMatches(page, "alpha.md", expected)).toBe(false);
  expect(await libraryFileMatches(page, "alpha.md", expected)).toBe(true);
  expect(handle.getFile).toHaveBeenCalledTimes(2);
});
it("does not turn a write failure into an unavailable read sample", async () => {
  stream.write.mockRejectedValueOnce(new DOMException("Write interrupted", "NotReadableError"));
  await expect(libraryFile(page, "alpha.md", "Proposed words")).rejects.toThrow("Write interrupted");
  expect(stream.close).not.toHaveBeenCalled(); expect(handle.getFile).not.toHaveBeenCalled();
});
it("does not acknowledge a write whose verification read is unavailable", async () => {
  handle.getFile.mockRejectedValueOnce(new DOMException("Cannot verify write", "NotReadableError"));
  await expect(libraryFile(page, "alpha.md", "Proposed words")).rejects.toThrow("Cannot verify write");
  expect(stream.write).toHaveBeenCalledWith("Proposed words"); expect(stream.close).toHaveBeenCalledOnce();
});
it.each(["NotAllowedError", "SecurityError"])("keeps %s read errors visible", async name => {
  handle.getFile.mockRejectedValueOnce(new DOMException("Permission denied", name));
  await expect(libraryFile(page, "alpha.md")).rejects.toThrow("Permission denied");
  handle.getFile.mockRejectedValueOnce(new DOMException("Permission denied", name));
  await expect(libraryFileMatches(page, "alpha.md", "Current")).rejects.toThrow("Permission denied");
});
it("does not swallow unrelated JavaScript exceptions with a similarly named error", async () => {
  handle.getFile.mockRejectedValueOnce(Object.assign(Error("Reader bug"), { name: "NotReadableError" }));
  await expect(libraryFile(page, "alpha.md")).rejects.toThrow("Reader bug");
});
it("preserves missing-file samples without creating a file", async () => {
  handle.getFile.mockRejectedValueOnce(new DOMException("Missing", "NotFoundError"));
  expect(await libraryFile(page, "alpha.md")).toBeUndefined();
  handle.getFile.mockRejectedValueOnce(new DOMException("Missing", "NotFoundError"));
  expect(await libraryFileMatches(page, "alpha.md", "Current")).toBe(false);
  expect(handle.createWritable).not.toHaveBeenCalled();
});
