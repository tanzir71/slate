import { nativeFileError } from "@slate/storage/tauri-files";
import type { TauriInvoke } from "../tauriAutosave";
import type { CaptureAPI } from "./captureSession";

// One main window can switch Spaces while an earlier activation is still in IPC.
// Send activations in order so an older reply cannot retarget the next global capture.
let activating = Promise.resolve();
export function createNativeCaptureActions(invoke: TauriInvoke, spaceId: string) {
  async function call(command: string, args: Record<string, unknown>) {
    try { return await invoke<unknown>(command, args); } catch (error) { throw nativeFileError(error); }
  }
  return {
    activate() {
      const next = activating.then(async () => {
        const reply = await call("set_capture_space", { spaceId });
        if (typeof reply !== "object" || reply === null) throw Error("Invalid Quick Capture status.");
        const status = reply as Record<string, unknown>;
        if (!(status.shortcutError === null || typeof status.shortcutError === "string") ||
            !(status.lastError === null || typeof status.lastError === "string")) throw Error("Invalid Quick Capture status.");
        return status.lastError ?? status.shortcutError;
      });
      activating = next.then(() => undefined, () => undefined);
      return next;
    },
    async open() { await call("open_native_capture", { spaceId }); },
  };
}

export async function nativeCaptureAPI(): Promise<CaptureAPI> {
  const [{ invoke }, { getCurrentWindow }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/window")]);
  const window = getCurrentWindow();
  async function call(command: string, args?: Record<string, unknown>) {
    try { return await invoke<unknown>(command, args); } catch (error) { throw nativeFileError(error); }
  }
  return {
    snapshot: () => call("capture_snapshot"),
    async stash(draft) { await call("stash_capture", { id: draft.id, text: draft.text, pending: draft.pending, revision: draft.revision }); },
    save: draft => call("save_capture", { id: draft.id, text: draft.text, revision: draft.revision }),
    onClose: listener => window.onCloseRequested(listener),
    requestClose: () => window.close(), destroy: () => window.destroy(),
    async showMain() { await call("capture_show_main"); },
  };
}
