import { expect, it, vi } from "vitest";
import { createFileSpace } from "../src/fileSpace";
import { createMemoryFiles, encodeText } from "../src/browserFiles";
import { onboardingPresetFiles } from "@slate/core";

it("adds actual reusable libraries while preserving every existing note and configuration byte", async () => {
  const files = createMemoryFiles({ "kept.md": "\ufeff# Kept\r\n", ".slate/snippets.json": "\ufeffUser configuration\r\n" });
  const space = createFileSpace(files), result = await space.prepareStarterPreset("writer").run();
  expect(result.added).toHaveLength(3); expect(result.kept).toEqual([".slate/snippets.json"]);
  expect(await files.read("kept.md")).toEqual(encodeText("\ufeff# Kept\r\n"));
  expect(await files.read(".slate/snippets.json")).toEqual(encodeText("\ufeffUser configuration\r\n"));
  for (const path of result.added) expect(await files.read(path)).toEqual(encodeText(onboardingPresetFiles("writer")[path]!));
});
it("retains partial additions and retries without replacing an edited starter template", async () => {
  const files = createMemoryFiles(), write = files.write, block = ".slate/blocks/Writing review.md";
  let failing = true;
  files.write = async (path, bytes) => { if (path === block && failing) throw Error("Disk disconnected"); await write(path, bytes); };
  const batch = createFileSpace(files).prepareStarterPreset("writer");
  await expect(batch.run()).rejects.toThrow("additions saved so far were kept");
  const template = ".slate/templates/Writer - Draft.md"; await write(template, encodeText("User edited the draft template"));
  failing = false; await batch.run(); await batch.run();
  expect(await files.read(template)).toEqual(encodeText("User edited the draft template"));
  expect((await files.list(true))).toHaveLength(4); expect(await files.read(block)).toBeDefined();
});
it("keeps even an unreadable existing configuration intact", async () => {
  const files = createMemoryFiles(), bytes = new Uint8Array([0xff, 0, 10]);
  await files.write(".slate/snippets.json", bytes);
  await createFileSpace(files).prepareStarterPreset("developer").run();
  expect(await files.read(".slate/snippets.json")).toEqual(bytes);
});
it("recovers a create reply lost after bytes reached disk without making duplicate library files", async () => {
  const files = createMemoryFiles(), write = files.write;
  let lost = true;
  files.write = async (path, bytes) => { await write(path, bytes); if (lost) { lost = false; throw Error("Create reply lost"); } };
  const batch = createFileSpace(files).prepareStarterPreset("researcher");
  await expect(batch.run()).rejects.toThrow("Create reply lost"); await batch.run();
  expect((await files.list(true))).toHaveLength(4);
  expect((await files.list(true)).sort()).toEqual(Object.keys(onboardingPresetFiles("researcher")).sort());
});
it("makes Minimal a no-write choice and rejects an unknown preset before queuing work", async () => {
  const files = createMemoryFiles(), write = vi.spyOn(files, "write"), space = createFileSpace(files);
  expect(await space.prepareStarterPreset("minimal").run()).toEqual({ added: [], kept: [] }); expect(write).not.toHaveBeenCalled();
  expect(() => space.prepareStarterPreset("missing")).toThrow("available starter kit");
});
it("makes Close/flush wait for the whole preset batch and respects a read-only Space", async () => {
  const files = createMemoryFiles(), write = files.write; let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); let first = true;
  files.write = async (path, bytes) => { if (first) { first = false; await held; } await write(path, bytes); };
  const space = createFileSpace(files), running = space.prepareStarterPreset("student").run();
  let closed = false; const closing = space.flush().then(() => { closed = true; }); await Promise.resolve(); expect(closed).toBe(false);
  release(); await running; await closing; expect((await files.list(true))).toHaveLength(4);
  await expect(createFileSpace(files, () => false).prepareStarterPreset("researcher").run()).rejects.toThrow("read-only");
});
