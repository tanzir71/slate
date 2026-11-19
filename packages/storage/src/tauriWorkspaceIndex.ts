import { markdownFileToSqliteIndexRow } from "./runtimeSqliteAdapter";
import { loadTauriSqliteIndex, type TauriSqliteIndexOptions } from "./tauriSql";
import type { TauriInvoke } from "./tauriFileSource";

async function nativeInvoke<Result>(command: string, args?: Record<string, unknown>): Promise<Result> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Result>(command, args);
}

/** A disposable cache: rebuild always starts from the current disk-backed sheets. */
export function createTauriWorkspaceIndex(options: Omit<TauriSqliteIndexOptions, "path"> = {}, invoke: TauriInvoke = nativeInvoke) {
  let closed = false;
  let database: ReturnType<typeof loadTauriSqliteIndex> | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: (index: Awaited<ReturnType<typeof loadTauriSqliteIndex>>) => Promise<T>) {
    const next = pending.then(async () => {
      if (closed) throw new Error("Space closed");
      database ??= loadTauriSqliteIndex(options);
      return work(await database);
    });
    pending = next.catch(() => undefined);
    return next;
  }
  return {
    rebuild(sheets: { path: string; content: string; unsupportedEncoding?: boolean }[]) {
      const rows = sheets.filter((sheet) => !sheet.unsupportedEncoding).map((sheet) => markdownFileToSqliteIndexRow(sheet.path, sheet.content));
      // The SQL plugin pools connections. A native transaction pins one
      // connection for the entire replacement instead of separate BEGIN/execute calls.
      return enqueue(() => invoke<void>("replace_workspace_index", { rows }));
    },
    search(query: string) { return enqueue(async (index) => (await index.searchSheets(query)).map((entry) => entry.path)); },
    close() {
      closed = true;
      void pending.then(async () => { if (database) await (await database).database.close?.(); }).catch(() => undefined);
    },
  };
}
