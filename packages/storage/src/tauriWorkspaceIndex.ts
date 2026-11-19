import { markdownFileToSqliteIndexRow } from "./runtimeSqliteAdapter";
import { nativeFileError } from "./tauriFiles";
import { safeWorkspacePath } from "./fileIO";
import type { TauriInvoke } from "./tauriFileSource";

async function nativeInvoke<Result>(command: string, args?: Record<string, unknown>): Promise<Result> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Result>(command, args);
}

/** A disposable cache: rebuild always starts from the current disk-backed sheets. */
export function createTauriWorkspaceIndex({ invoke = nativeInvoke }: { invoke?: TauriInvoke } = {}) {
  let closed = false;
  let pending: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>) {
    const next = pending.then(async () => {
      if (closed) throw new Error("Space closed");
      try { return await work(); } catch (cause) { throw nativeFileError(cause); }
    });
    pending = next.catch(() => undefined);
    return next;
  }
  return {
    rebuild(sheets: { path: string; content: string; unsupportedEncoding?: boolean }[]) {
      const rows = sheets.map((sheet) => markdownFileToSqliteIndexRow(sheet.path, sheet.unsupportedEncoding ? "" : sheet.content));
      // Only the backend chooses a cache file or SQL statement. Replacements
      // remain one native transaction; failures never write source files.
      return enqueue(() => invoke<void>("replace_workspace_index", { rows }));
    },
    search(query: string) { return enqueue(async () => {
      const reply = await invoke<unknown>("search_workspace_index", { query });
      if (!Array.isArray(reply) || !reply.every((path: unknown) => {
        if (typeof path !== "string") return false;
        try { return safeWorkspacePath(path) === path; } catch { return false; }
      })) throw new Error("Invalid native search response");
      return reply as string[];
    }); },
    close() {
      closed = true;
    },
  };
}
