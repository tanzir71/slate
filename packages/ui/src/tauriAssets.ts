import { invokeTauri, type TauriInvoke } from "./tauriAutosave";
import { nativeFileError } from "@slate/storage/tauri-files";

export interface NumberedAssetWriter {
  importNumberedFile(path: string, bytes: Uint8Array): Promise<string>;
}

export function createTauriAssetWriter({
  invoke = invokeTauri,
}: { invoke?: TauriInvoke } = {}): NumberedAssetWriter {
  return {
    async importNumberedFile(path, bytes) {
      const result: unknown = await invoke("write_numbered_asset", {
        path,
        bytes: Array.from(bytes),
      }).catch((cause: unknown) => { throw nativeFileError(cause); });
      const prefix = path.slice(0, -4) + "-";
      if (
        !path.endsWith(".png") ||
        typeof result !== "string" ||
        !result.startsWith(prefix) ||
        !result.endsWith(".png") ||
        !/^[1-9]\d*$/.test(result.slice(prefix.length, -4))
      ) {
        throw new Error("Invalid native asset response");
      }
      return result;
    },
  };
}
