import { useEffect, useRef, useState } from "react";
import type { WorkspaceStore } from "./workspaceStore";
import type { WorkspaceFileActions, WorkspaceFileInfo } from "./workspaceRuntime";

export interface NativeFileModel {
  readonly info: WorkspaceFileInfo | undefined;
  readonly pending: boolean;
  readonly revealing: boolean;
  readonly error: string;
  refresh(): void;
  reveal(): void;
  retry(): void;
}
interface FileState { path: string; info: WorkspaceFileInfo | undefined; pending: boolean; revealing: boolean; infoError: string; revealError: string }
const initial = (path: string): FileState => ({ path, info: undefined, pending: true, revealing: false, infoError: "", revealError: "" });
const message = (error: unknown) => error instanceof Error ? error.message : "File information is unavailable. Try again.";

/** Read-only capabilities are independent of edit ownership; stale replies never cross file identity. */
export function useNativeFileInfo(store: WorkspaceStore, path: string, actions: WorkspaceFileActions | undefined): NativeFileModel | undefined {
  const [state, setState] = useState<FileState>(() => initial(path));
  const operations = useRef<{ path: string; actions: WorkspaceFileActions; refresh(): void; reveal(): void } | undefined>(undefined);
  useEffect(() => {
    if (!actions || !path) { operations.current = undefined; return; }
    let active = true, request = 0, revealing = false;
    setState(initial(path));
    function refresh() {
      const id = ++request;
      setState(value => ({ ...value, pending: true, infoError: "" }));
      void actions!.info(path).then(info => {
        if (active && id === request) setState(value => ({ ...value, info, pending: false, infoError: "" }));
      }).catch(error => {
        if (active && id === request) setState(value => ({ ...value, info: undefined, pending: false, infoError: message(error) }));
      });
    }
    function reveal() {
      if (revealing) return;
      revealing = true; setState(value => ({ ...value, revealing: true, revealError: "" }));
      void actions!.reveal(path).catch(error => {
        if (active) setState(value => ({ ...value, revealError: message(error) }));
      }).finally(() => {
        revealing = false; if (active) setState(value => ({ ...value, revealing: false }));
      });
    }
    operations.current = { path, actions, refresh, reveal }; refresh();
    const stop = store.subscribeNoteSaved(note => { if (note.path === path) refresh(); });
    return () => { active = false; operations.current = undefined; stop(); };
  }, [store, path, actions]);
  if (!actions || !path) return;
  const current = state.path === path ? state : initial(path);
  const run = (kind: "refresh" | "reveal") => {
    const operation = operations.current;
    if (operation?.path === path && operation.actions === actions) operation[kind]();
  };
  return { info: current.info, pending: current.pending, revealing: current.revealing, error: current.revealError || current.infoError,
    refresh: () => run("refresh"), reveal: () => run("reveal"), retry: () => run(current.revealError ? "reveal" : "refresh") };
}
