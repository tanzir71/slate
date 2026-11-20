import type { WorkspaceStore } from "./workspaceStore";

/** Per-Space, session-only visits. Navigation never writes note content itself. */
export function createWorkspaceNavigation(store: WorkspaceStore) {
  let paths: string[] = [], position = -1, busy = false;
  let intent: { path: string; from: string; position: number; invalidated: boolean } | undefined;
  let snapshot = { canBack: false, canForward: false, busy: false };
  const listeners = new Set<() => void>();

  function candidate(direction: -1 | 1) {
    const current = store.api.getState();
    const available = new Set(current.sheets.map((sheet) => sheet.path));
    for (let index = position + direction; index >= 0 && index < paths.length; index += direction) {
      const path = paths[index]!;
      if (path !== current.selectedPath && available.has(path)) return { path, position: index };
    }
    return undefined;
  }
  function publish() {
    const next = { canBack: !!candidate(-1), canForward: !!candidate(1), busy };
    if (next.canBack === snapshot.canBack && next.canForward === snapshot.canForward && next.busy === snapshot.busy) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function visit(path: string) {
    if (!path || paths[position] === path) return;
    paths = [...paths.slice(0, position + 1), path].slice(-100);
    position = paths.length - 1;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect() {
      visit(store.api.getState().selectedPath); publish();
      return store.api.subscribe((state, previous) => {
        if (state.selectedPath !== previous.selectedPath) {
          if (intent && !intent.invalidated && intent.path === state.selectedPath && intent.from === previous.selectedPath)
            position = intent.position;
          else {
            if (intent) intent.invalidated = true;
            visit(state.selectedPath);
          }
          publish();
        } else if (state.sheets.length !== previous.sheets.length) publish();
        // Content edits do not scan the workspace or publish navigation state.
      });
    },
    async go(direction: -1 | 1) {
      if (busy) return;
      const target = candidate(direction);
      if (!target) { publish(); return; }
      busy = true;
      const request = { ...target, from: store.api.getState().selectedPath, invalidated: false };
      intent = request;
      publish();
      try {
        // openSheet flushes the current draft, re-reads disk and rejects concurrent edits.
        return await store.openSheet(target.path, undefined, () => !request.invalidated);
      } finally { intent = undefined; busy = false; publish(); }
    },
  };
}
