import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { shortcutOS } from "../commands";
import type { WindowChrome } from "../browser/WindowTitleBar";
import { createNativeWindowChrome } from "./nativeWindow";

export function useNativeWindowChrome(failed: (error: unknown) => void): false | WindowChrome {
  const [chrome, setChrome] = useState<false | WindowChrome>(false);
  useEffect(() => {
    if (!isTauri()) return;
    const controller = createNativeWindowChrome(getCurrentWindow(), shortcutOS(), failed);
    const stop = controller.subscribe(() => setChrome(controller.getSnapshot()));
    setChrome(controller.getSnapshot());
    void controller.connect();
    return () => { stop(); controller.dispose(); };
  }, [failed]);
  return chrome;
}
