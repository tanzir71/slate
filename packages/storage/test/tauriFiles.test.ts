import { expect, it, vi } from "vitest";
import { createTauriWorkspaceFiles } from "../src/tauriFiles";
import type { TauriInvoke } from "../src/tauriFileSource";

function fixture(reply: unknown, scope: "space" | "global" = "space") {
  const calls = vi.fn(async (_command: string, _args?: Record<string, unknown>) => reply);
  const invoke: TauriInvoke = async <Result>(command: string, args?: Record<string, unknown>) => await calls(command, args) as Result;
  return { calls, files: createTauriWorkspaceFiles({ invoke, scope }) };
}

it("captures a Space ID in every file operation while global files remain shared", async () => {
  const replies: Record<string, unknown> = { list_workspace_files: [], read_workspace_file: null, create_workspace_file: true, save_workspace_file: { status: "written", path: "a.md" }, move_workspace_file: null, trash_workspace_file: ".slate/trash/a.md" };
  const calls = vi.fn(async (command: string, _args?: Record<string, unknown>) => replies[command]);
  const options = { invoke: calls as TauriInvoke, spaceId: "first" };
  const first = createTauriWorkspaceFiles(options);
  options.spaceId = "second";
  await first.list(); await first.read("a.md"); await first.operations.createNew("a.md", new Uint8Array());
  await first.operations.save("a.md", new Uint8Array(), undefined);
  await first.operations.move("a.md", "b.md", new Uint8Array()); await first.operations.trash("a.md", new Uint8Array());
  expect(calls.mock.calls).toHaveLength(6);
  for (const call of calls.mock.calls) expect(call[1]).toMatchObject({ scope: "space", spaceId: "first" });
  calls.mockClear();
  await createTauriWorkspaceFiles({ ...options, scope: "global" }).read("global/snippets.json");
  expect(calls).toHaveBeenCalledExactlyOnceWith("read_workspace_file", { scope: "global", path: "global/snippets.json" });
});

it("lists only valid relative paths and preserves the selected root scope", async () => {
  const { files, calls } = fixture(["Inbox/a.md", ".slate/snippets.json"], "global");
  expect(await files.list(true)).toEqual(["Inbox/a.md", ".slate/snippets.json"]);
  expect(calls).toHaveBeenCalledExactlyOnceWith("list_workspace_files", { scope: "global", includePrivate: true });
});

it("distinguishes missing, empty and binary files without a lossy text decoder", async () => {
  expect(await fixture(null).files.read("note.md")).toBeUndefined();
  expect(Array.from((await fixture([]).files.read("note.md"))!)).toEqual([]);
  const { files, calls } = fixture([0xef, 0xbb, 0xbf, 0xff, 0x00]);
  expect(Array.from((await files.read("note.md"))!)).toEqual([0xef, 0xbb, 0xbf, 0xff, 0x00]);
  expect(calls).toHaveBeenCalledExactlyOnceWith("read_workspace_file", { scope: "space", path: "note.md" });
});

it("creates only when absent and supplies exact original bytes to checked writes", async () => {
  const { files, calls } = fixture(true);
  expect(await files.operations.createNew("note.md", new Uint8Array([1]))).toBe(true);
  expect(calls).toHaveBeenCalledExactlyOnceWith("create_workspace_file", { scope: "space", path: "note.md", bytes: [1] });
  const saved = fixture({ status: "conflict-copy", path: "note (conflicted copy 1-1).md" });
  expect(await saved.files.operations.save("note.md", new Uint8Array([2]), new Uint8Array([1]))).toEqual({ path: "note (conflicted copy 1-1).md", conflict: true });
  expect(saved.calls).toHaveBeenCalledExactlyOnceWith("save_workspace_file", { scope: "space", path: "note.md", bytes: [2], baseBytes: [1] });
  const missing = fixture({ status: "written", path: "new.md" });
  await missing.files.operations.save("new.md", new Uint8Array(), undefined);
  expect(missing.calls).toHaveBeenCalledExactlyOnceWith("save_workspace_file", { scope: "space", path: "new.md", bytes: [], baseBytes: null });
});

it("sends move/trash byte snapshots and requires a retained trash location", async () => {
  const moved = fixture(null);
  await moved.files.operations.move("a.md", "Book/a.md", new Uint8Array([3]));
  expect(moved.calls).toHaveBeenCalledExactlyOnceWith("move_workspace_file", { scope: "space", from: "a.md", to: "Book/a.md", baseBytes: [3] });
  const trashed = fixture(".slate/trash/1/a.md");
  expect(await trashed.files.operations.trash("a.md", new Uint8Array([3]))).toBe(".slate/trash/1/a.md");
  expect(trashed.calls).toHaveBeenCalledExactlyOnceWith("trash_workspace_file", { scope: "space", path: "a.md", baseBytes: [3] });
});

it.each(["../escape.md", "/outside.md", "C:/outside.md", "a/../b.md", "a\u0000.md"])("rejects %j before IPC", async (path) => {
  const { files, calls } = fixture(null);
  await expect(files.read(path)).rejects.toThrow("Invalid workspace path");
  await expect(files.operations.createNew(path, new Uint8Array())).rejects.toThrow("Invalid workspace path");
  expect(calls).not.toHaveBeenCalled();
});

it.each([["../escape.md"], [1], {}, ["/outside.md"]])("rejects an invalid list reply %j", async (reply) => {
  await expect(fixture(reply).files.list()).rejects.toThrow("Invalid native file list");
});

it.each([[256], [-1], [1.1], [null], "text", {}])("rejects invalid native byte payload %j", async (reply) => {
  await expect(fixture(reply).files.read("note.md")).rejects.toThrow("Invalid native file bytes");
});

it("preserves a typed native rejection for the workspace error state", async () => {
  const invoke: TauriInvoke = async () => { throw { kind: "path-escapes-root", message: "Outside this Space" }; };
  await expect(createTauriWorkspaceFiles({ invoke }).read("note.md")).rejects.toMatchObject({ kind: "path-escapes-root", message: "Outside this Space" });
});
