import { useEffect, useState } from "react";
import type { WorkspaceStore } from "../browser/workspaceStore";
import type { BlockLibrary } from "./blockLibrary";

export function useBlockLibrary(store: WorkspaceStore) {
  const [selected, setSelected] = useState<{
    store: WorkspaceStore;
    library: BlockLibrary;
  }>();
  const library = selected?.store === store ? selected.library : undefined;
  useEffect(() => {
    let active = true,
      current: BlockLibrary | undefined;
    const spaceId = store.api.getState().record.id;
    const reload = () => {
      void current?.refresh();
    };
    const notify = () => {
      if (typeof BroadcastChannel !== "function") return;
      const channel = new BroadcastChannel("slate-blocks");
      try {
        channel.postMessage(spaceId);
      } finally {
        channel.close();
      }
    };
    void import("./blockLibrary")
      .then(({ createBlockLibrary }) => {
        if (!active) return;
        current = createBlockLibrary(
          store.space,
          () => store.api.getState().owned,
          notify,
        );
        setSelected({ store, library: current });
        reload();
      })
      .catch((cause: unknown) => {
        if (active)
          store.api.setState({
            notice:
              cause instanceof Error
                ? cause.message
                : "Custom blocks could not be loaded.",
          });
      });
    window.addEventListener("focus", reload);
    let observer: BroadcastChannel | undefined;
    try {
      if (typeof BroadcastChannel === "function")
        observer = new BroadcastChannel("slate-blocks");
    } catch {
      /* Focus and visible file polling still refresh the catalog. */
    }
    if (observer)
      observer.onmessage = (event) => {
        if (event.data === spaceId) reload();
      };
    return () => {
      active = false;
      current?.dispose();
      observer?.close();
      window.removeEventListener("focus", reload);
    };
  }, [store]);
  return { library };
}
