import { nativeFileError } from "@slate/storage/tauri-files";
import type { TauriInvoke } from "../tauriAutosave";

export interface NativeSpace { readonly id: string; readonly name: string; readonly path: string | null }
export const defaultNativeSpace: NativeSpace = { id: "native-default", name: "Slate", path: null };
export function checkedNativeSpace(value: unknown): NativeSpace {
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
/** Native picker, OS file requests and host-owned Documents creation admit folders. */
export function createNativeSpaceCatalog(invoke: TauriInvoke = nativeInvoke) {
  let saving = Promise.resolve();
  async function call(command: string, args?: Record<string, unknown>) {
    try { return args === undefined ? await invoke<unknown>(command) : await invoke<unknown>(command, args); } catch (cause) { throw nativeFileError(cause); }
  }
  return {
    async list() {
      const reply = await call("list_native_spaces");
      if (!Array.isArray(reply)) throw Error("Invalid native Spaces list.");
      const records = reply.map(checkedNativeSpace);
      if (records[0]?.id !== defaultNativeSpace.id || new Set(records.map(space => space.id)).size !== records.length) throw Error("Invalid native Spaces list.");
      return records;
    },
    async pick() { const reply = await call("pick_native_space"); return reply === null ? null : checkedNativeSpace(reply); },
    async create(name: string, welcome: string) {
      const space = checkedNativeSpace(await call("create_native_space", { name, welcome }));
      if (space.id === defaultNativeSpace.id) throw Error("The desktop did not create a new folder Space.");
      return space;
    },
    async startup() { const reply = await call("startup_native_space"); return reply === null ? null : checkedNativeSpace(reply); },
    remember(id: string) {
      // A newer successful open must not be overwritten by a delayed earlier IPC write.
      const next = saving.then(async () => {
        const space = checkedNativeSpace(await call("remember_native_space", { id }));
        if (space.id !== id) throw Error("The desktop remembered a different Space. Your notes were kept.");
        return space;
      });
      saving = next.then(() => {}, () => {});
      return next;
    },
  };
}
export type NativeSpaceCatalog = ReturnType<typeof createNativeSpaceCatalog>;
