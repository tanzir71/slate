import { safeWorkspacePath } from "@slate/storage/file-io";
import { nativeFileError } from "@slate/storage/tauri-files";
import { isEditorSheetPath } from "../browser/editorSheetPath";
import type { WorkspaceFileActions, WorkspaceFileInfo } from "../browser/workspaceRuntime";
import type { TauriInvoke } from "../tauriAutosave";

function checkedPath(path: string): string {
  if (safeWorkspacePath(path) !== path || !isEditorSheetPath(path)) throw Error("Choose an ordinary Markdown sheet in this Space.");
  return path;
}
function validInfo(value: unknown): value is WorkspaceFileInfo {
  if (typeof value !== "object" || value === null) return false;
  const info = value as Record<string, unknown>;
  return typeof info.absolutePath === "string" && /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(info.absolutePath) &&
    typeof info.bytes === "number" && Number.isSafeInteger(info.bytes) && info.bytes >= 0 &&
    (info.modifiedAt === null || typeof info.modifiedAt === "number" && Number.isSafeInteger(info.modifiedAt) && info.modifiedAt >= 0 && !Number.isNaN(new Date(info.modifiedAt).getTime())) &&
    typeof info.revealLabel === "string" && ["Show in Explorer", "Show in Finder", "Show in file manager"].includes(info.revealLabel);
}
/** No generic native opener is exposed; both commands accept only a Space-relative sheet path. */
export function createNativeFileActions(invoke: TauriInvoke): WorkspaceFileActions {
  return {
    async info(path) {
      try {
        const reply = await invoke<unknown>("read_workspace_file_info", { path: checkedPath(path) });
        if (!validInfo(reply)) throw Error("The native file information is invalid. Try opening the Inspector again.");
        return reply;
      } catch (error) { throw nativeFileError(error); }
    },
    async reveal(path) {
      try { await invoke("reveal_workspace_file", { path: checkedPath(path) }); }
      catch (error) { throw nativeFileError(error); }
    },
  };
}
