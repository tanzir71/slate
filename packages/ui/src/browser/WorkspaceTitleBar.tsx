import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowUpFromLine,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  Plus,
  Search,
  X,
} from "lucide-react";
import { SegmentedViewMode } from "./SegmentedViewMode";
import type { WorkspaceViewMode } from "./workspaceViewModes";

interface WindowActions {
  minimize(): void;
  maximize(): void;
  close(): void;
  maximized?: boolean;
}
interface TitleBarProps {
  windowControls: false | WindowActions;
  space: string;
  path: string;
  inspector: boolean;
  onSwitchSpace(): void;
  onNotebook(path: string): void;
  onNavigation(): void;
  onSheets(): void;
  onSearch(): void;
  onNew(): void;
  onExport(): void;
  onInspector(): void;
  shortcut(id: string): string;
  controls: ReactNode;
  menuControls?: ReactNode;
  actions: { label: string; disabled?: boolean; run(): void }[];
  canWrite: boolean;
  viewMode: WorkspaceViewMode;
  viewDisabled: boolean;
  onViewMode(mode: WorkspaceViewMode): void;
}

export function WorkspaceTitleBar({
  windowControls,
  space,
  path,
  inspector,
  onSwitchSpace,
  onNotebook,
  onNavigation,
  onSheets,
  onSearch,
  onNew,
  onExport,
  onInspector,
  shortcut,
  controls,
  menuControls,
  actions,
  canWrite,
  viewMode,
  viewDisabled,
  onViewMode,
}: TitleBarProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const menuButton = useRef<HTMLElement>(null);
  const parts = path.split("/").filter(Boolean);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        menu.current?.open &&
        event.target instanceof Node &&
        !menu.current.contains(event.target)
      )
        menu.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <header
      className="workspaceHeader"
      data-window-controls={windowControls !== false}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current?.open) {
          menu.current.open = false;
          menuButton.current?.focus();
          event.stopPropagation();
        }
      }}
    >
      <button
        aria-label="Show navigation"
        title={`Navigation (${shortcut("view.sidebar")})`}
        className="headerNavigation"
        onClick={onNavigation}
      >
        <PanelLeft size={16} />
      </button>
      <button
        aria-label="Show sheets"
        title={`Sheets (${shortcut("view.sheets")})`}
        className="headerSheets"
        onClick={onSheets}
      >
        <PanelsTopLeft size={16} />
      </button>
      <nav className="headerBreadcrumb" aria-label="Sheet location">
        <button title="Switch Space" onClick={onSwitchSpace}>
          {space}
        </button>
        {parts.map((part, index) => (
          <span key={`${index}/${part}`}>
            <span className="breadcrumbSlash" aria-hidden="true">
              /
            </span>
            {index === parts.length - 1 ? (
              <span aria-current="page" className="breadcrumbFile">
                {part}
              </span>
            ) : (
              <button
                onClick={() => onNotebook(parts.slice(0, index + 1).join("/"))}
              >
                {part}
              </button>
            )}
          </span>
        ))}
      </nav>
      <div className="workspaceHeaderTools">
        <SegmentedViewMode className="headerViewMode" value={viewMode} disabled={viewDisabled} onChange={onViewMode} />
        <button
          aria-label="Search everywhere"
          title={`Search everywhere (${shortcut("sheet.search")})`}
          onClick={(event) => { event.currentTarget.focus(); onSearch(); }}
        >
          <Search size={16} />
        </button>
        <button
          aria-label="New Sheet"
          title={`New sheet (${shortcut("sheet.new")})`}
          disabled={!canWrite}
          onClick={onNew}
        >
          <Plus size={17} />
        </button>
        <button
          aria-label="Export .zip"
          title="Export Space as .zip"
          onClick={onExport}
        >
          <ArrowUpFromLine size={16} />
        </button>
        <button
          aria-label="Toggle inspector"
          aria-pressed={inspector}
          title={`Inspector (${shortcut("view.inspector")})`}
          onClick={onInspector}
        >
          <PanelRight size={16} />
        </button>
        {controls}
        <details className="sheetActionsMenu" ref={menu}>
          <summary
            role="button"
            ref={menuButton}
            aria-label="Sheet actions"
            title="Sheet actions"
          >
            <MoreHorizontal size={17} />
          </summary>
          <div className="sheetActionsItems">
            <SegmentedViewMode className="menuViewMode" value={viewMode} disabled={viewDisabled} onChange={onViewMode} />
            {actions.map((action) => (
              <button
                key={action.label}
                disabled={action.disabled}
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                  menuButton.current?.focus();
                  action.run();
                }}
              >
                {action.label}
              </button>
            ))}
            <div className="mobileAppearance">{menuControls}</div>
          </div>
        </details>
      </div>
      {windowControls && (
        <div className="nativeWindowControls">
          <button aria-label="Minimize" onClick={windowControls.minimize}>
            <Minus size={16} />
          </button>
          <button
            aria-label="Maximize or restore"
            onClick={windowControls.maximize}
          >
            {windowControls.maximized ? (
              <Minimize2 size={16} />
            ) : (
              <Maximize2 size={16} />
            )}
          </button>
          <button aria-label="Close window" onClick={windowControls.close}>
            <X size={16} />
          </button>
        </div>
      )}
    </header>
  );
}
