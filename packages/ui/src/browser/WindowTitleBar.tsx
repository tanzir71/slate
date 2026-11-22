import type { KeyboardEventHandler, ReactNode } from "react";
import { Copy } from "lucide-react";

export interface WindowChrome {
  readonly platform: "windows" | "linux" | "mac";
  readonly maximized: boolean;
  minimize(): void;
  maximize(): void;
  close(): void;
  startDragging(): void;
}

/** The web uses the same header without native controls or a drag region. */
export function WindowTitleBar({ windowControls, children, onKeyDown, controlIcons }: {
  windowControls: false | WindowChrome; children: ReactNode; onKeyDown?: KeyboardEventHandler<HTMLElement>;
  controlIcons?: { minimize: ReactNode; maximize: ReactNode; close: ReactNode };
}) {
  const controls = windowControls && windowControls.platform !== "mac";
  return <header className={`workspaceHeader${windowControls ? " nativeTitleBar" : ""}`}
    data-native-platform={windowControls ? windowControls.platform : undefined}
    data-window-controls={Boolean(controls)} onKeyDown={onKeyDown}>
    {children}
    {controls && <div className="nativeWindowControls" role="group" aria-label="Window controls">
      <button aria-label="Minimize" title="Minimize" onClick={windowControls.minimize}>
        {controlIcons?.minimize ?? <span className="windowControlIcon windowMinimizeIcon" aria-hidden="true" />}
      </button>
      <button aria-label={windowControls.maximized ? "Restore window" : "Maximize"}
        title={windowControls.maximized ? "Restore window" : "Maximize"} onClick={windowControls.maximize}>
        {windowControls.maximized ? <Copy size={16} aria-hidden="true" /> : controlIcons?.maximize ?? <span className="windowControlIcon windowMaximizeIcon" aria-hidden="true" />}
      </button>
      <button aria-label="Close window" title="Close window" onClick={windowControls.close}>
        {controlIcons?.close ?? <span className="windowControlIcon windowCloseIcon" aria-hidden="true" />}
      </button>
    </div>}
  </header>;
}

/** Only empty space initiates a native drag; controls keep their normal input. */
export function WindowDragRegion({ windowControls }: { windowControls: false | WindowChrome }) {
  if (!windowControls) return null;
  return <div className="nativeTitlebarDrag" aria-hidden="true" onMouseDown={(event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (event.detail === 2) windowControls.maximize();
    else windowControls.startDragging();
  }} />;
}
