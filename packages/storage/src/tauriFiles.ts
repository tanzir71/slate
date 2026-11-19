import { safeWorkspacePath, type CheckedWorkspaceFiles } from "./fileIO";
import type { TauriInvoke } from "./tauriFileSource";

export type NativeFileScope = "space" | "global";
export interface TauriWorkspaceFilesOptions {
  readonly scope?: NativeFileScope;
  readonly invoke?: TauriInvoke;
}
export class NativeFileError extends Error {
  constructor(readonly kind: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "NativeFileError";
  }
}
function rejection(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  if (typeof cause === "object" && cause !== null && "kind" in cause && typeof cause.kind === "string" && "message" in cause && typeof cause.message === "string") return new NativeFileError(cause.kind, cause.message, cause);
  return new NativeFileError("native", typeof cause === "string" ? cause : "Native file operation failed.", cause);
}
function byteArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((byte: unknown) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255);
}
function relativePath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return safeWorkspacePath(value) === value; } catch { return false; }
}
async function nativeInvoke<Result>(command: string, args?: Record<string, unknown>): Promise<Result> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Result>(command, args);
}

/** Every mutation carries its own byte snapshot; no unchecked write/remove operation is exposed. */
export function createTauriWorkspaceFiles({ scope = "space", invoke = nativeInvoke }: TauriWorkspaceFilesOptions = {}): CheckedWorkspaceFiles {
  async function call(command: string, args: Record<string, unknown>) {
    try { return await invoke<unknown>(command, { scope, ...args }); }
    catch (cause) { throw rejection(cause); }
  }
  return {
    async list(includePrivate = false) {
      const reply = await call("list_workspace_files", { includePrivate });
      if (!Array.isArray(reply) || !reply.every(relativePath)) throw new Error("Invalid native file list");
      return reply as string[];
    },
    async read(path) {
      const reply = await call("read_workspace_file", { path: safeWorkspacePath(path) });
      if (reply === null) return undefined;
      if (!byteArray(reply)) throw new Error("Invalid native file bytes");
      return new Uint8Array(reply);
    },
    operations: {
      async createNew(path, bytes) {
        const reply = await call("create_workspace_file", { path: safeWorkspacePath(path), bytes: Array.from(bytes) });
        if (typeof reply !== "boolean") throw new Error("Invalid native create response");
        return reply;
      },
      async save(path, bytes, base) {
        const target = safeWorkspacePath(path);
        const reply = await call("save_workspace_file", { path: target, bytes: Array.from(bytes), baseBytes: base ? Array.from(base) : null });
        if (typeof reply !== "object" || reply === null || !("path" in reply) || !relativePath(reply.path) || !("status" in reply) || (reply.status !== "written" && reply.status !== "conflict-copy") || (reply.status === "written" && reply.path !== target) || (reply.status === "conflict-copy" && reply.path === target)) throw new Error("Invalid native save response");
        return { path: reply.path, conflict: reply.status === "conflict-copy" };
      },
      async move(from, to, base) {
        const reply = await call("move_workspace_file", { from: safeWorkspacePath(from), to: safeWorkspacePath(to), baseBytes: Array.from(base) });
        if (reply !== null) throw new Error("Invalid native move response");
      },
      async trash(path, base) {
        const reply = await call("trash_workspace_file", { path: safeWorkspacePath(path), baseBytes: Array.from(base) });
        if (!relativePath(reply) || !reply.startsWith(".slate/trash/")) throw new Error("Invalid native trash response");
        return reply;
      },
    },
  };
}
