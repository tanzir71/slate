import { nativeFileError } from "@slate/storage/tauri-files";
import { safeWorkspacePath } from "@slate/storage/file-io";
import type { TauriInvoke } from "../tauriAutosave";
import { checkedNativeSpace, type NativeSpace } from "./nativeSpaces";

export interface NativeLaunchRequest { readonly id: string; readonly url: string; readonly phase: "pending" | "started" | "applied"; readonly spaceId?: string | null; readonly fileName?: string | null }
export interface NativeFileTarget { readonly space: NativeSpace; readonly url: string; readonly path: string }
export interface NativeLaunchSnapshot { readonly revision: number; readonly current: NativeLaunchRequest | null; readonly waiting: number; readonly error: string | null }
export interface NativeLaunchSource {
  run<T>(work: () => Promise<T>): Promise<T>;
  quiesce(): Promise<() => void>;
  pending(): Promise<NativeLaunchSnapshot>;
  bind(id: string, spaceId: string): Promise<NativeLaunchSnapshot>;
  begin(id: string, claim: string): Promise<NativeLaunchSnapshot>;
  applied(id: string, claim: string): Promise<NativeLaunchSnapshot>;
  review(id: string): Promise<NativeLaunchSnapshot>;
  complete(id: string): Promise<NativeLaunchSnapshot>;
  next(): Promise<NativeLaunchSnapshot>;
  resolveFile(id: string): Promise<NativeFileTarget>;
  listen(receive: (snapshot: NativeLaunchSnapshot) => void, failed: (error: unknown) => void): Promise<() => void>;
}
function checked(value: unknown): NativeLaunchSnapshot {
  if (typeof value !== "object" || value === null) throw Error("Invalid desktop link response.");
  const data = value as Record<string, unknown>, current = data.current;
  if (typeof data.revision !== "number" || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      typeof data.waiting !== "number" || !Number.isSafeInteger(data.waiting) || data.waiting < 0 ||
      !(data.error === null || typeof data.error === "string")) throw Error("Invalid desktop link response.");
  if (current !== null) {
    if (typeof current !== "object" || current === undefined) throw Error("Invalid desktop link response.");
    const request = current as Record<string, unknown>;
    if (typeof request.id !== "string" || !request.id || typeof request.url !== "string" ||
        typeof request.phase !== "string" || !["pending", "started", "applied"].includes(request.phase) ||
        request.spaceId !== null && request.spaceId !== undefined && (typeof request.spaceId !== "string" || !request.spaceId) ||
        request.fileName !== null && request.fileName !== undefined && (typeof request.fileName !== "string" || !request.fileName)) throw Error("Invalid desktop link response.");
  }
  return data as unknown as NativeLaunchSnapshot;
}
/** Share this across a native window's Space sessions so Close waits for a file-driven switch. */
export function createNativeLaunchWork() {
  const running = new Set<Promise<unknown>>();
  let closing = false;
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      if (closing) return Promise.reject(Error("Slate is closing. Keep the window open to finish this request."));
      const task = Promise.resolve().then(work); running.add(task);
      void task.then(() => running.delete(task), () => running.delete(task));
      return task;
    },
    async quiesce() {
      closing = true;
      try { while (running.size) await Promise.all([...running]); }
      catch (cause) { closing = false; throw cause; }
      return () => { closing = false; };
    },
  };
}
/** Only a host-owned OS file queue ID can admit a root; URLs remain relative to existing Spaces. */
export function createNativeLaunchSource(invoke: TauriInvoke, listen: (receive: (payload: unknown) => void) => Promise<() => void>, work = createNativeLaunchWork()): NativeLaunchSource {
  async function call(command: string, id?: string, extra?: Record<string, string>) {
    try { return checked(await invoke<unknown>(command, id === undefined ? undefined : { id, ...extra })); }
    catch (cause) { throw nativeFileError(cause); }
  }
  return {
    ...work,
    pending: () => call("pending_native_launches"),
    bind: (id, spaceId) => call("bind_native_launch", id, { spaceId }),
    begin: (id, claim) => call("begin_native_launch", id, { claim }),
    applied: (id, claim) => call("apply_native_launch", id, { claim }),
    review: id => call("review_native_launch", id),
    complete: id => call("complete_native_launch", id),
    next: () => call("next_native_launch"),
    async resolveFile(id) {
      try {
        const reply = await invoke<unknown>("resolve_native_file", { id });
        if (typeof reply !== "object" || reply === null) throw Error("Invalid native file response.");
        const data = reply as Record<string, unknown>, space = checkedNativeSpace(data.space);
        if (typeof data.url !== "string" || typeof data.path !== "string") throw Error("Invalid native file response.");
        const path = safeWorkspacePath(data.path), url = new URL(data.url), keys = [...url.searchParams.keys()];
        if (path !== data.path || !/\.md$/i.test(path) || path.split("/").some(part => /^(?:\.slate|\.git)$/i.test(part)) ||
            !["slate:", "slate-preview:"].includes(url.protocol) || url.hostname !== "open" || url.username || url.password || url.port || url.hash ||
            url.pathname !== "" && url.pathname !== "/" || keys.length !== 2 || !keys.includes("space") || !keys.includes("path") ||
            url.searchParams.get("space") !== space.id || url.searchParams.get("path") !== path) throw Error("Invalid native file response.");
        return { space, url: data.url, path };
      } catch (cause) { throw nativeFileError(cause); }
    },
    listen: (receive, failed) => listen(payload => { try { receive(checked(payload)); } catch (error) { failed(error); } }),
  };
}
