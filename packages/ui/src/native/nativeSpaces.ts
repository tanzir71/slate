import { nativeFileError } from "@slate/storage/tauri-files";
import type { TauriInvoke } from "../tauriAutosave";

export interface NativeSpace { readonly id: string; readonly name: string; readonly path: string | null }
export const defaultNativeSpace: NativeSpace = { id: "native-default", name: "Slate", path: null };
function checked(value: unknown): NativeSpace {
  if (typeof value !== "object" || value === null) throw Error("Invalid native Space response.");
  const space = value as Record<string, unknown>;
  if (typeof space.id !== "string" || !/^(?:native-default|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.test(space.id) ||
      typeof space.name !== "string" || !space.name.trim() ||
      !(space.id === defaultNativeSpace.id ? space.path === null : typeof space.path === "string" && /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(space.path))) {
    throw Error("Invalid native Space response.");
  }
  return { id: space.id, name: space.name, path: space.path as string | null };
}
async function nativeInvoke<Result>(command: string, args?: Record<string, unknown>): Promise<Result> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Result>(command, args);
}
/** Only the native picker can admit a folder. No renderer-supplied root reaches IPC. */
export function createNativeSpaceCatalog(invoke: TauriInvoke = nativeInvoke) {
  async function call(command: string) {
    try { return await invoke<unknown>(command); } catch (cause) { throw nativeFileError(cause); }
  }
  return {
    async list() {
      const reply = await call("list_native_spaces");
      if (!Array.isArray(reply)) throw Error("Invalid native Spaces list.");
      const records = reply.map(checked);
      if (records[0]?.id !== defaultNativeSpace.id || new Set(records.map(space => space.id)).size !== records.length) throw Error("Invalid native Spaces list.");
      return records;
    },
    async pick() { const reply = await call("pick_native_space"); return reply === null ? null : checked(reply); },
  };
}
export type NativeSpaceCatalog = ReturnType<typeof createNativeSpaceCatalog>;
