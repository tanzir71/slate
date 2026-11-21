import { afterEach, expect, it, vi } from "vitest";
import { installSheetListSeedWorker } from "../../../e2e/sheetListCorpusWorker";

afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(globalThis, "onmessage"); });

function fixture(failure?: "write" | "read") {
  const files = new Map<string, Uint8Array>(), close = vi.fn(), directories: string[] = [];
  const root = { getDirectoryHandle: async (name: string): Promise<object> => { directories.push(name); return root; },
    getFileHandle: async (name: string) => ({ createSyncAccessHandle: async () => ({
      truncate: () => { files.set(name, new Uint8Array()); },
      write: (bytes: Uint8Array, options: { at: number }) => { expect(options.at).toBe(0); files.set(name, bytes.slice()); return failure === "write" ? bytes.length - 1 : bytes.length; },
      read: (bytes: Uint8Array, options: { at: number }) => { expect(options.at).toBe(0); bytes.set(files.get(name)!); return failure === "read" ? bytes.length - 1 : bytes.length; },
      getSize: () => files.get(name)!.length, close,
    }) }),
  };
  const reply = vi.fn();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });
  vi.stubGlobal("postMessage", reply); installSheetListSeedWorker();
  const message = Reflect.get(globalThis, "onmessage") as (event: { data: { id: string; start: number; step: number; count: number } }) => Promise<void>;
  return { files, close, directories, reply, run: (start: number) => message({ data: { id: "chosen-space", start, step: 4, count: 100 } }) };
}

it("writes and reads back all 100 original note paths and exact UTF-8 bytes in the captured Space", async () => {
  const app = fixture();
  for (let slot = 0; slot < 4; slot++) await app.run(slot);
  expect(app.files.size).toBe(100); expect(app.close).toHaveBeenCalledTimes(100);
  expect(app.directories).toEqual(Array.from({ length: 4 }, () => ["spaces", "chosen-space"]).flat());
  expect(app.reply.mock.calls).toEqual(Array.from({ length: 4 }, () => [{ written: 25 }]));
  for (let index = 0; index < 100; index++)
    expect(Array.from(app.files.get(`Note${String(index).padStart(3, "0")}.md`)!)).toEqual(Array.from(new TextEncoder().encode(`# Note ${index}\n\nExact writing ${index}.`)));
});

it.each(["write", "read"] as const)("closes the access handle and reports a partial %s without claiming the corpus is complete", async failure => {
  const app = fixture(failure); await app.run(0);
  expect(app.close).toHaveBeenCalledOnce(); expect(app.files.size).toBe(1);
  expect(app.reply).toHaveBeenCalledExactlyOnceWith({ error: expect.stringContaining(failure === "write" ? "write was incomplete" : "did not round-trip") });
});
