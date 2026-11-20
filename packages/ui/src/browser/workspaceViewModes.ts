import type { WorkspaceStore } from "./workspaceStore";

export type WorkspaceViewMode = "live" | "source" | "read";
export const workspaceViewModes = ["live", "source", "read"] as const;
export function nextWorkspaceViewMode(mode: WorkspaceViewMode): WorkspaceViewMode {
  return workspaceViewModes[(workspaceViewModes.indexOf(mode) + 1) % workspaceViewModes.length]!;
}
type ViewStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function browserStorage(): ViewStorage | undefined {
  try { return localStorage; } catch { return undefined; }
}
function validMode(value: string | null | undefined): WorkspaceViewMode {
  return value === "source" || value === "read" ? value : "live";
}

/** Device view preferences never write Markdown or require the Space's editing lease. */
export function createWorkspaceViewModes(store: WorkspaceStore, storage = browserStorage()) {
  const prefix = `slate.view-mode.${encodeURIComponent(store.api.getState().record.id)}.`;
  const cached = new Map<string, WorkspaceViewMode>(), listeners = new Set<() => void>();
  let version = 0;
  function notify() { version++; for (const listener of listeners) listener(); }
  const key = (path: string) => prefix + encodeURIComponent(path);
  function mode(path: string): WorkspaceViewMode {
    if (!path) return "live";
    const known = cached.get(path); if (known !== undefined) return known;
    let value: WorkspaceViewMode = "live";
    try { value = validMode(storage?.getItem(key(path))); } catch { /* Optional device preference. */ }
    cached.set(path, value); return value;
  }
  function save(path: string, value: WorkspaceViewMode) {
    cached.set(path, value);
    try { storage?.setItem(key(path), value); } catch { /* Keep the current session usable. */ }
  }
  return {
    mode,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => version,
    set(path: string, value: WorkspaceViewMode) {
      if (!store.api.getState().sheets.some(sheet => sheet.path === path && !sheet.unsupportedEncoding)) return;
      if (mode(path) === value) return;
      save(path, value); notify();
    },
    connect() {
      const stop = store.subscribeSheetMoved((from, to) => {
        save(to, mode(from)); cached.delete(from);
        try { storage?.removeItem(key(from)); } catch { /* The file move already succeeded. */ }
        notify();
      });
      const changed = (event: StorageEvent) => {
        if (event.storageArea && event.storageArea !== storage || event.key !== null && !event.key.startsWith(prefix)) return;
        cached.clear(); notify();
      };
      window.addEventListener("storage", changed);
      return () => { stop(); window.removeEventListener("storage", changed); };
    },
  };
}
