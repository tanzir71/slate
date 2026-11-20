import { expect, it, vi } from "vitest";
import { createNativeFileActions } from "../src/native/nativeFileActions";
import type { TauriInvoke } from "../src/tauriAutosave";

const info = { absolutePath: "C:\\Notes\\বাংলা note.md", bytes: 17, modifiedAt: 1795161600000, revealLabel: "Show in Explorer" };
it("reads real file information and reveals only its captured ordinary Markdown path", async () => {
  const invoke = vi.fn(async (command: string) => command === "read_workspace_file_info" ? info : undefined);
  const actions = createNativeFileActions(invoke as TauriInvoke);
  expect(await actions.info("Work/বাংলা note.md")).toEqual(info);
  await actions.reveal("Work/বাংলা note.md");
  expect(invoke.mock.calls).toEqual([["read_workspace_file_info", { path: "Work/বাংলা note.md" }], ["reveal_workspace_file", { path: "Work/বাংলা note.md" }]]);
});
it("refuses traversal, private files and non-sheet actions before invoking native code", async () => {
  const invoke = vi.fn(), actions = createNativeFileActions(invoke as TauriInvoke);
  for (const path of ["../outside.md", "C:/file.md", ".slate/tidy.json", ".git/config.md", "asset.png", "Work\\note.md"]) {
    await expect(actions.info(path)).rejects.toThrow(); await expect(actions.reveal(path)).rejects.toThrow();
  }
  expect(invoke).not.toHaveBeenCalled();
});
it("validates native metadata and preserves structured native errors", async () => {
  for (const value of [{ ...info, bytes: -1 }, { ...info, absolutePath: "" }, { ...info, absolutePath: "relative.md" }, { ...info, modifiedAt: NaN }, { ...info, revealLabel: "Other action" }, { ...info, revealLabel: ["Show in Explorer"] }]) {
    const actions = createNativeFileActions(vi.fn(async () => value) as TauriInvoke);
    await expect(actions.info("note.md")).rejects.toThrow(/file information/i);
  }
  const actions = createNativeFileActions(vi.fn(async () => { throw { kind: "permission", message: "Access denied" }; }) as TauriInvoke);
  await expect(actions.info("note.md")).rejects.toThrow("Access denied"); await expect(actions.reveal("note.md")).rejects.toThrow("Access denied");
});
