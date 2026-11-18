import { useEffect, useState, useSyncExternalStore } from "react";
import type { WorkspaceStore } from "../browser/workspaceStore";
import type { SnippetLibrary } from "./snippetLibrary";

const subscribeEmpty = () => () => undefined;
const getEmpty = () => undefined;
export function useSnippetLibrary(store: WorkspaceStore) {
  const [selected, setSelected] = useState<{
    store: WorkspaceStore;
    library: SnippetLibrary;
    session: typeof import("./snippetSession");
  }>();
  const library = selected?.store === store ? selected.library : undefined;
  useEffect(() => {
    let active = true,
      current: SnippetLibrary | undefined;
    const reload = () => {
      void current?.refresh();
    };
    void Promise.all([import("./snippetLibrary"), import("./snippetSession")])
      .then(([{ createSnippetLibrary }, session]) => {
        if (!active) return;
        current = createSnippetLibrary(store.space);
        setSelected({ store, library: current, session });
        reload();
      })
      .catch((error: unknown) => {
        if (active)
          store.api.setState({
            error:
              error instanceof Error
                ? error.message
                : "Snippets could not be loaded.",
          });
      });
    window.addEventListener("focus", reload);
    let observer: BroadcastChannel | undefined;
    try {
      if (typeof BroadcastChannel === "function")
        observer = new BroadcastChannel("slate-snippets");
    } catch {
      /* Focus and visible file polling still refresh definitions. */
    }
    if (observer) observer.onmessage = reload;
    return () => {
      active = false;
      current?.dispose();
      observer?.close();
      window.removeEventListener("focus", reload);
    };
  }, [store]);
  const snapshot = useSyncExternalStore(
    library?.subscribe ?? subscribeEmpty,
    library?.getSnapshot ?? getEmpty,
  );
  return {
    library,
    snapshot,
    session: selected?.store === store ? selected.session : undefined,
  };
}
