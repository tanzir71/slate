import { useId, useLayoutEffect, useRef } from "react";
import { Columns2 } from "lucide-react";
import type { WorkspaceEditorLayout } from "./workspaceEditorLayout";
import "./editorTabs.css";

const fileTitle = (path: string) => path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path;

export function EditorTabs({ layout, dirty, label = fileTitle, onOpen, onClose, onNew, onSplit }: {
  layout: WorkspaceEditorLayout;
  dirty(path: string): boolean;
  label?(path: string): string;
  onOpen(path: string, focusEditor: boolean): void;
  onClose(path: string): void;
  onNew(): void;
  onSplit(): void;
}) {
  const id = useId(), current = layout[layout.active] ?? "";
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current, layout.tabs]);
  return <div className="editorTabsBar">
    <div className="editorTabsScroll" style={{ gridTemplateColumns: `repeat(${Math.max(1, layout.tabs.length)}, max-content)` }}>
    <div ref={list} className="editorTabs" role={layout.tabs.length ? "tablist" : "group"} aria-label="Open sheets" onKeyDown={(event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
      const index = layout.tabs.indexOf(current), length = layout.tabs.length;
      if (!length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const next = event.key === "Home" ? 0 : event.key === "End" ? length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + length) % length;
      event.preventDefault(); onOpen(layout.tabs[next]!, false);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>
      {layout.tabs.map((path, index) => <button className="editorTab" data-selected={path === current} key={path}
          type="button" role="tab" id={`${id}-${index}`} aria-label={path} aria-selected={path === current} tabIndex={path === current ? 0 : -1}
          aria-controls="workspace-editor-panel" aria-describedby={dirty(path) ? `${id}-dirty-${index}` : undefined} title={path} onClick={() => onOpen(path, true)}>
          <span className="tabGlyph tabGlyph--file" aria-hidden="true" /><span className="editorTabLabel">{label(path)}</span>
          {dirty(path) && <span className="tabGlyph tabGlyph--dirty" aria-hidden="true" />}
          {dirty(path) && <span id={`${id}-dirty-${index}`} className="visuallyHidden">Unsaved changes</span>}
        </button>)}
    </div>
    <div className="editorTabClosers" role="group" aria-label="Close sheets">
      {layout.tabs.map((path) => <button key={path} type="button" className="editorTabClose" aria-label={`Close ${path}`} title={`Close ${path}`} onClick={() => onClose(path)}><span className="tabGlyph tabGlyph--close" aria-hidden="true" /></button>)}
    </div>
    </div>
    <div className="editorTabActions">
      <button type="button" aria-label="Open sheet in tab" title="Open sheet in tab" onClick={onNew}><span className="tabGlyph tabGlyph--plus" aria-hidden="true" /></button>
      <button type="button" aria-label={layout.secondary === undefined ? "Split editor" : "Close split"} title={layout.secondary === undefined ? "Split editor" : "Close split"}
        disabled={!current && layout.secondary === undefined} aria-pressed={layout.secondary !== undefined} onClick={onSplit}><Columns2 size={16} aria-hidden="true" /></button>
    </div>
  </div>;
}
