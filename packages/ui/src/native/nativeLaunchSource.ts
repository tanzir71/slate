import { nativeFileError } from "@slate/storage/tauri-files";
import type { TauriInvoke } from "../tauriAutosave";

export interface NativeLaunchRequest { readonly id: string; readonly url: string; readonly phase: "pending" | "started" | "applied"; readonly spaceId?: string | null }
export interface NativeLaunchSnapshot { readonly revision: number; readonly current: NativeLaunchRequest | null; readonly waiting: number; readonly error: string | null }
export interface NativeLaunchSource {
  run(work: () => Promise<void>): Promise<void>;
  quiesce(): Promise<() => void>;
  pending(): Promise<NativeLaunchSnapshot>;
  bind(id: string, spaceId: string): Promise<NativeLaunchSnapshot>;
  begin(id: string, claim: string): Promise<NativeLaunchSnapshot>;
  applied(id: string, claim: string): Promise<NativeLaunchSnapshot>;
  review(id: string): Promise<NativeLaunchSnapshot>;
  complete(id: string): Promise<NativeLaunchSnapshot>;
  next(): Promise<NativeLaunchSnapshot>;
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
        request.spaceId !== null && request.spaceId !== undefined && (typeof request.spaceId !== "string" || !request.spaceId)) throw Error("Invalid desktop link response.");
  }
  return data as unknown as NativeLaunchSnapshot;
}
/** Narrow queue IPC; URLs never grant a filesystem root or protocol-registration permission. */
export function createNativeLaunchSource(invoke: TauriInvoke, listen: (receive: (payload: unknown) => void) => Promise<() => void>): NativeLaunchSource {
  const running = new Set<Promise<void>>();
  let closing = false;
  async function call(command: string, id?: string, extra?: Record<string, string>) {
    try { return checked(await invoke<unknown>(command, id === undefined ? undefined : { id, ...extra })); }
    catch (cause) { throw nativeFileError(cause); }
  }
  return {
    run(work) {
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
    pending: () => call("pending_native_launches"),
    bind: (id, spaceId) => call("bind_native_launch", id, { spaceId }),
    begin: (id, claim) => call("begin_native_launch", id, { claim }),
    applied: (id, claim) => call("apply_native_launch", id, { claim }),
    review: id => call("review_native_launch", id),
    complete: id => call("complete_native_launch", id),
    next: () => call("next_native_launch"),
    listen: (receive, failed) => listen(payload => { try { receive(checked(payload)); } catch (error) { failed(error); } }),
  };
}
