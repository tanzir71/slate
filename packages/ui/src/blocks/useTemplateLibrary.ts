import { useEffect, useState } from "react";
import type { WorkspaceStore } from "../browser/workspaceStore";
import type { TemplateLibrary } from "./templateLibrary";

export function useTemplateLibrary(store: WorkspaceStore) {
  const [selected, setSelected] = useState<{
    store: WorkspaceStore;
    library: TemplateLibrary;
  }>();
  const library = selected?.store === store ? selected.library : undefined;
  useEffect(() => {
    let active = true,
      current: TemplateLibrary | undefined;
    const refresh = () => {
      void current?.refresh();
    };
    void import("./templateLibrary")
      .then(({ createTemplateLibrary }) => {
        if (!active) return;
        current = createTemplateLibrary(
          store.space,
          () => store.api.getState().owned,
        );
        setSelected({ store, library: current });
        refresh();
      })
      .catch((cause: unknown) => {
        if (active)
          store.api.setState({
            notice:
              cause instanceof Error
                ? cause.message
                : "Templates could not be loaded.",
          });
      });
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      current?.dispose();
      window.removeEventListener("focus", refresh);
    };
  }, [store]);
  return { library };
}
