import { createFileSpace } from "@slate/storage/file-space";
import { createTauriWorkspaceFiles } from "@slate/storage/tauri-files";
import { createSnippetFileStore, globalSnippetPath } from "@slate/storage/browser-space";
import { createWorkspaceStore } from "../browser/workspaceStore";
import type { WorkspaceRuntime, WorkspaceFileActions } from "../browser/workspaceRuntime";
import { createNativeFileActions } from "./nativeFileActions";
import { createTauriWorkspaceIndex } from "@slate/storage/tauri-workspace-index";
import { defaultNativeSpace, type NativeSpace } from "./nativeSpaces";
import type { WorkspaceFiles } from "@slate/storage/file-io";
import { createNativeLaunchSource, type NativeLaunchSource } from "./nativeLaunchSource";

export interface NativeChange { scope: "space" | "global"; spaceId?: string | null; error: string | null }
interface CloseRequest { preventDefault(): void }
export interface NativeLifecycle {
  fileActions?: WorkspaceFileActions;
  launches?: NativeLaunchSource;
  listen(change: (event: NativeChange) => void): Promise<() => void>;
  watchStatus(): Promise<string[]>;
  onClose(request: (event: CloseRequest) => void): Promise<() => void>;
  destroy(): Promise<void>;
}

export async function nativeLifecycle(spaceId = defaultNativeSpace.id): Promise<NativeLifecycle> {
  const [{ listen }, { getCurrentWindow }, { invoke }] = await Promise.all([
    import("@tauri-apps/api/event"), import("@tauri-apps/api/window"), import("@tauri-apps/api/core"),
  ]);
  const window = getCurrentWindow();
  return {
    fileActions: createNativeFileActions(invoke, spaceId),
    launches: createNativeLaunchSource(invoke, receive => listen<unknown>("slate://launch-changed", event => receive(event.payload))),
    listen: (change) => listen<NativeChange>("slate://workspace-changed", (event) => change(event.payload)),
    watchStatus: () => invoke<string[]>("workspace_watch_status", { spaceId }),
    onClose: (request) => window.onCloseRequested(request),
    destroy: () => window.destroy(),
  };
}

export function createNativeWorkspace(lifecycle: NativeLifecycle, files: WorkspaceFiles | undefined = undefined, globalFiles: WorkspaceFiles = createTauriWorkspaceFiles({ scope: "global" }), space: NativeSpace = defaultNativeSpace) {
  const store = createWorkspaceStore({ id: space.id, name: space.name, tier: "folder" }, files ?? createTauriWorkspaceFiles({ spaceId: space.id }));
  const globalSpace = createFileSpace(globalFiles);
  const runtime: WorkspaceRuntime = {
    surface: "desktop",
    ...(lifecycle.fileActions ? { fileActions: lifecycle.fileActions } : {}),
    ...(lifecycle.launches ? { launches: lifecycle.launches } : {}),
    async openGlobalSnippets() {
      // Native saves compare exact disk bytes under the process-wide filesystem
      // lock; conflicts from another process are retained by the backend, too.
      return createSnippetFileStore(globalSpace, globalSnippetPath, (save) => save());
    },
    async observe(refresh, failed) {
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = await lifecycle.listen((change) => {
        if (!active) return;
        if (change.scope === "space" && (change.spaceId ?? defaultNativeSpace.id) !== space.id) return;
        if (change.error) failed(new Error(change.error));
        clearTimeout(timer);
        timer = setTimeout(() => { if (active) refresh(); }, 25);
      });
      try { for (const error of await lifecycle.watchStatus()) failed(new Error(error)); }
      catch (error) { failed(error); }
      // Reconcile the interval between initial loading and listener registration.
      refresh();
      return () => { active = false; clearTimeout(timer); stop(); };
    },
  };
  return {
    store, runtime, space,
    createIndex: () => createTauriWorkspaceIndex({ spaceId: space.id }),
    async open() { await store.load(); store.setOwned(true); await store.flush(); },
    async protectClose() {
      let closing = false;
      return lifecycle.onClose((event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        let resume: (() => void) | undefined;
        void (async () => {
          resume = await lifecycle.launches?.quiesce();
          await store.flush(); await lifecycle.destroy();
        })().catch((error: unknown) => {
          store.api.setState({ error: error instanceof Error ? error.message : "Saving failed. Keep Slate open until your words are saved." });
        }).finally(() => { resume?.(); closing = false; });
      });
    },
  };
}
