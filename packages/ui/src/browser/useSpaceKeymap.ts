import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  resolveCommandKeymap,
  type ResolvedKeymap,
  type ShortcutOS,
  type ShortcutProfile,
} from "@slate/core";
import { readKeymap, workspaceCommands } from "../commands";
import type { WorkspaceStore } from "./workspaceStore";

export function useSpaceKeymap(
  store: WorkspaceStore,
  os: ShortcutOS,
  surface: ShortcutProfile["surface"],
) {
  const owner = useMemo(() => ({ store, os, surface }), [store, os, surface]);
  const current = useRef(owner),
    generation = useRef(0);
  const defaults = useMemo(
    () =>
      resolveCommandKeymap(
        { os, surface },
        undefined,
        workspaceCommands(surface),
      ),
    [os, surface],
  );
  const [loaded, setLoaded] = useState<{
    owner: typeof owner;
    keymap: ResolvedKeymap;
  }>();
  useLayoutEffect(() => {
    current.current = owner;
  }, [owner]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const request = ++generation.current;
      let keymap: ResolvedKeymap;
      try {
        keymap = readKeymap(
          await store.space.files.read(".slate/keymap.json"),
          os,
          surface,
        );
      } catch {
        keymap = {
          ...defaults,
          issues: [
            {
              commandId: "",
              message:
                "The Space keymap could not be read. Default shortcuts remain active.",
            },
          ],
        };
      }
      if (active && request === generation.current)
        setLoaded({ owner, keymap });
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      generation.current++;
      window.removeEventListener("focus", load);
    };
  }, [owner, defaults, store, os, surface]);
  function accept(bytes: Uint8Array) {
    if (current.current !== owner) return;
    generation.current++;
    setLoaded({ owner, keymap: readKeymap(bytes, os, surface) });
  }
  const ready = loaded?.owner === owner;
  return { ready, keymap: ready ? loaded.keymap : defaults, accept };
}
