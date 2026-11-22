import { expect, it, vi } from "vitest";
import { createNativeSpaceCatalog, defaultNativeSpace } from "../src/native/nativeSpaces";
import type { TauriInvoke } from "../src/tauriAutosave";

const folder = { id: "12345678-1234-4321-9876-123456789abc", name: "বাংলা Notes", path: "C:\\Notes" };
it("reads persistent records and lets only the native picker supply a folder", async () => {
  const invoke = vi.fn(async (command: string) => command === "list_native_spaces" ? [defaultNativeSpace, folder] : folder);
  const catalog = createNativeSpaceCatalog(invoke as TauriInvoke);
  expect(await catalog.list()).toEqual([defaultNativeSpace, folder]); expect(await catalog.pick()).toEqual(folder);
  expect(invoke.mock.calls).toEqual([["list_native_spaces"], ["pick_native_space"]]);
});
it("treats picker cancellation as no selection and keeps structured native errors", async () => {
  const invoke = vi.fn(async (): Promise<unknown> => null);
  const catalog = createNativeSpaceCatalog(invoke as TauriInvoke);
  expect(await catalog.pick()).toBeNull();
  invoke.mockRejectedValueOnce({ kind: "io", message: "Catalog is invalid; files were kept" });
  await expect(catalog.list()).rejects.toThrow("Catalog is invalid; files were kept");
});
it.each([null, [], [folder], [defaultNativeSpace, defaultNativeSpace], [defaultNativeSpace, { ...folder, id: "../root" }], [defaultNativeSpace, { ...folder, path: "relative" }], [defaultNativeSpace, { ...folder, name: " " }]])("rejects malformed native catalogs %j", async reply => {
  await expect(createNativeSpaceCatalog(vi.fn(async () => reply) as TauriInvoke).list()).rejects.toThrow(/Invalid native/);
});

it("reads only host-validated startup records and remembers only the requested ID", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(folder).mockResolvedValueOnce(folder);
  const catalog = createNativeSpaceCatalog(invoke as TauriInvoke);
  expect(await catalog.startup()).toBeNull(); expect(await catalog.startup()).toEqual(folder);
  expect(await catalog.remember(folder.id)).toEqual(folder);
  expect(invoke.mock.calls).toEqual([["startup_native_space"], ["startup_native_space"], ["remember_native_space", { id: folder.id }]]);
  invoke.mockResolvedValueOnce(defaultNativeSpace); await expect(catalog.remember(folder.id)).rejects.toThrow("different Space");
  invoke.mockResolvedValueOnce({ ...folder, path: "relative" }); await expect(catalog.startup()).rejects.toThrow("Invalid native");
});

it("serializes remembered choices so a delayed or failed older save cannot overwrite the latest choice", async () => {
  let fail!: (reason: Error) => void;
  const held = new Promise<unknown>((_resolve, reject) => { fail = reject; });
  const invoke = vi.fn().mockReturnValueOnce(held).mockResolvedValueOnce(folder);
  const catalog = createNativeSpaceCatalog(invoke as TauriInvoke);
  const first = catalog.remember(defaultNativeSpace.id), second = catalog.remember(folder.id);
  await Promise.resolve(); expect(invoke).toHaveBeenCalledTimes(1);
  fail(Error("First selection failed")); await expect(first).rejects.toThrow("First selection failed");
  expect(await second).toEqual(folder);
  expect(invoke.mock.calls).toEqual([["remember_native_space", { id: defaultNativeSpace.id }], ["remember_native_space", { id: folder.id }]]);
});
