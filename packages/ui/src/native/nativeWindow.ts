import type { WindowChrome } from "../browser/WindowTitleBar";

export interface NativeWindowAPI {
  isMaximized(): Promise<boolean>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  onResized(listener: () => void): Promise<() => void>;
}

/** A native close request must reach protectClose; destroy belongs to that guard. */
export function createNativeWindowChrome(window: NativeWindowAPI, platform: WindowChrome["platform"], failed: (error: unknown) => void) {
  const listeners = new Set<() => void>();
  let active = true, connected = false, revision = 0;
  let stop: (() => void) | undefined;
  const run = (action: () => Promise<void>) => { if (active) void action().catch((error: unknown) => { if (active) failed(error); }); };
  let snapshot: WindowChrome = {
    platform, maximized: false,
    minimize: () => run(() => window.minimize()),
    maximize: () => run(async () => { await window.toggleMaximize(); await refresh(); }),
    close: () => run(() => window.close()),
    startDragging: () => run(() => window.startDragging()),
  };
  async function refresh() {
    if (!active) return;
    const current = ++revision;
    try {
      const maximized = await window.isMaximized();
      if (!active || current !== revision || maximized === snapshot.maximized) return;
      snapshot = { ...snapshot, maximized };
      for (const listener of listeners) listener();
    } catch (error) { if (active && current === revision) failed(error); }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async connect() {
      if (!active || connected) return;
      connected = true;
      try {
        const unlisten = await window.onResized(() => { void refresh(); });
        if (active) stop = unlisten; else unlisten();
      } catch (error) { if (active) failed(error); }
      if (active) await refresh();
    },
    dispose() { active = false; revision++; stop?.(); stop = undefined; listeners.clear(); },
  };
}
