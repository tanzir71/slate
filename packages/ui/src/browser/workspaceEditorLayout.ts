import type { WorkspaceStore } from "./workspaceStore";
import { isEditorSheetPath } from "./editorSheetPath";

export type EditorPaneId = "primary" | "secondary";
export interface WorkspaceEditorLayout {
  readonly tabs: readonly string[];
  readonly primary: string;
  readonly secondary: string | undefined;
  readonly active: EditorPaneId;
}

/** View/session state only. Closing a tab never removes a file or a draft. */
export function createWorkspaceEditorLayout(store: WorkspaceStore) {
  const exists = (path: string) => isEditorSheetPath(path) && store.api.getState().sheets.some((sheet) => sheet.path === path);
  const current = store.api.getState().selectedPath, selected = exists(current) ? current : "";
  let snapshot: WorkspaceEditorLayout = Object.freeze({ tabs: Object.freeze(selected ? [selected] : []), primary: selected, secondary: undefined, active: "primary" });
  let disposed = false, projecting = false;
  let closed: { path: string; index: number }[] = [];
  let connection: (() => void) | undefined;
  const listeners = new Set<() => void>();
  function publish(next: WorkspaceEditorLayout, project = false) {
    if (next.primary === snapshot.primary && next.secondary === snapshot.secondary && next.active === snapshot.active &&
      next.tabs.length === snapshot.tabs.length && next.tabs.every((path, index) => path === snapshot.tabs[index])) return;
    const changedPane = next.active !== snapshot.active;
    snapshot = Object.freeze({ ...next, tabs: Object.freeze([...next.tabs]) });
    closed = closed.filter((entry) => !snapshot.tabs.includes(entry.path));
    if (project) {
      projecting = true;
      try { store.activateSheet(snapshot[snapshot.active] ?? "", changedPane); }
      finally { projecting = false; }
    }
    for (const listener of listeners) listener();
  }
  function synchronize() {
    if (projecting || disposed) return;
    closed = closed.filter((entry) => exists(entry.path));
    const path = store.api.getState().selectedPath, tabs = snapshot.tabs.filter(exists);
    let primary = exists(snapshot.primary) ? snapshot.primary : "";
    let secondary = snapshot.secondary === undefined ? undefined : exists(snapshot.secondary) ? snapshot.secondary : "";
    let active = snapshot.active;
    if (exists(path)) {
      if (!tabs.includes(path)) tabs.push(path);
      if (active === "secondary" && secondary !== undefined) secondary = path; else primary = path;
    }
    if (!tabs.length) { primary = ""; secondary = undefined; active = "primary"; }
    publish({ tabs, primary, secondary, active });
  }
  function open(path: string, index = snapshot.tabs.length) {
    if (disposed || !exists(path)) return false;
    const tabs = [...snapshot.tabs];
    if (!tabs.includes(path)) tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, path);
    publish({ ...snapshot, tabs, [snapshot.active]: path }, true);
    return true;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect() {
      if (disposed) return () => undefined;
      if (connection) return connection;
      const stop = store.api.subscribe((state, previous) => {
        if (state.sheets !== previous.sheets || state.selectedPath !== previous.selectedPath) synchronize();
      });
      const disconnect = () => { stop(); if (connection === disconnect) connection = undefined; };
      connection = disconnect; synchronize(); return disconnect;
    },
    open,
    cycle(direction: -1 | 1) {
      const tabs = snapshot.tabs, index = tabs.indexOf(snapshot[snapshot.active] ?? "");
      if (disposed || tabs.length < 2) return false;
      const next = index < 0 ? direction === 1 ? 0 : tabs.length - 1 : (index + direction + tabs.length) % tabs.length;
      return open(tabs[next]!);
    },
    reopen() {
      if (disposed) return false;
      while (closed.length) { const entry = closed.pop()!; if (open(entry.path, entry.index)) return true; }
      return false;
    },
    focus(pane: EditorPaneId) {
      if (disposed || snapshot[pane] === undefined) return false;
      publish({ ...snapshot, active: pane }, true); return true;
    },
    split() {
      const path = snapshot[snapshot.active];
      if (disposed || snapshot.secondary !== undefined || !path || !exists(path)) return false;
      publish({ ...snapshot, secondary: path, active: "secondary" }, true); return true;
    },
    collapse() {
      if (disposed || snapshot.secondary === undefined) return false;
      publish({ ...snapshot, primary: snapshot[snapshot.active] ?? "", secondary: undefined, active: "primary" }, true); return true;
    },
    close(path: string) {
      if (disposed || !snapshot.tabs.includes(path)) return false;
      closed.push({ path, index: snapshot.tabs.indexOf(path) });
      const tabs = snapshot.tabs.filter((tab) => tab !== path), replacement = tabs[Math.min(snapshot.tabs.indexOf(path), tabs.length - 1)] ?? "";
      publish({ tabs, primary: snapshot.primary === path ? replacement : snapshot.primary,
        secondary: tabs.length && snapshot.secondary !== undefined ? snapshot.secondary === path ? replacement : snapshot.secondary : undefined,
        active: tabs.length ? snapshot.active : "primary" }, true);
      return true;
    },
    dispose() { disposed = true; connection?.(); listeners.clear(); },
  };
}

export type WorkspaceEditorLayoutStore = ReturnType<typeof createWorkspaceEditorLayout>;
