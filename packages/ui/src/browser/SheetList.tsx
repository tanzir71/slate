import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SheetDocument, WorkspacePreferences } from "@slate/core";
import { SheetRow } from "./SheetRow";
import { sheetWindow } from "./sheetWindow";

interface SheetListProps {
  sheets: readonly SheetDocument[];
  selectedPath: string;
  preferences: WorkspacePreferences;
  owned: boolean;
  pending: boolean;
  readOnlyPaths: ReadonlySet<string>;
  onOpen(path: string): void;
  onBulk(action: "move" | "trash", paths: string[]): void;
  onTidy?(paths: string[]): void;
}
export function SheetList({
  sheets,
  selectedPath,
  preferences,
  owned,
  pending,
  readOnlyPaths,
  onOpen,
  onBulk,
  onTidy,
}: SheetListProps) {
  const container = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [focusPath, setFocusPath] = useState<string>();
  const rowHeight = preferences.density === "compact" ? 61 : 88;
  const window = sheetWindow(
    sheets.length,
    viewport.height,
    viewport.top,
    rowHeight,
  );
  const editable = sheets.filter((sheet) => !readOnlyPaths.has(sheet.path));
  const selected = editable
    .filter((sheet) => checked.has(sheet.path))
    .map((sheet) => sheet.path);
  const selectedIndex = sheets.findIndex(
    (sheet) => sheet.path === selectedPath,
  );

  useLayoutEffect(() => {
    const element = container.current!;
    const resize = () =>
      setViewport({
        top: element.scrollTop,
        height: element.clientHeight || 600,
      });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = container.current!;
    if (
      selectedIndex >= 0 &&
      (selectedIndex * rowHeight < element.scrollTop ||
        (selectedIndex + 1) * rowHeight >
          element.scrollTop + element.clientHeight)
    ) {
      element.scrollTop = selectedIndex * rowHeight;
      setViewport({
        top: element.scrollTop,
        height: element.clientHeight || 600,
      });
    }
  }, [selectedIndex, rowHeight]);

  useLayoutEffect(() => {
    if (!focusPath) return;
    const button = Array.from(
      container.current!.querySelectorAll<HTMLButtonElement>(
        ".browserSheetRow",
      ),
    ).find((element) => element.dataset.path === focusPath);
    if (button) {
      button.focus();
      setFocusPath(undefined);
    }
  }, [focusPath, window.start, window.end]);

  return (
    <>
      <div className="sheetSelectionControls">
        <button
          disabled={!owned || !editable.length}
          // Selection mode is view state; file actions below still wait for current paths.
          aria-pressed={selecting}
          onClick={() => {
            setSelecting((value) => !value);
            setChecked(new Set());
          }}
        >
          {selecting ? "Done selecting" : "Select sheets"}
        </button>
        {selecting && (
          <>
            <label>
              <input
                type="checkbox"
                aria-label="Select all filtered sheets"
                disabled={!owned || pending || !editable.length}
                checked={
                  !!editable.length && selected.length === editable.length
                }
                onChange={(event) =>
                  setChecked(
                    new Set(
                      event.target.checked
                        ? editable.map((sheet) => sheet.path)
                        : [],
                    ),
                  )
                }
              />
              {selected.length} selected
            </label>
            <button
              disabled={!owned || pending || !selected.length}
              onClick={() => onBulk("move", selected)}
            >
              Move
            </button>
            <button
              disabled={!owned || pending || !selected.length}
              onClick={() => onBulk("trash", selected)}
            >
              Delete
            </button>
            {onTidy && <button disabled={pending || !selected.length} onClick={() => onTidy(selected)}>Tidy selected</button>}
          </>
        )}
      </div>
      <div
        ref={container}
        className="browserSheetRows"
        aria-busy={pending}
        data-density={preferences.density}
        onScroll={(event) =>
          setViewport({
            top: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight,
          })
        }
        onKeyDown={(event) => {
          if (
            pending ||
            !(event.target instanceof HTMLElement) ||
            !event.target.matches(".browserSheetRow") ||
            !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
          )
            return;
          const path = event.target.dataset.path;
          const index = sheets.findIndex((sheet) => sheet.path === path);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? sheets.length - 1
                : Math.max(
                    0,
                    Math.min(
                      sheets.length - 1,
                      index + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
          const target = sheets[next];
          if (!target) return;
          event.preventDefault();
          const element = container.current!;
          if (next * rowHeight < element.scrollTop)
            element.scrollTop = next * rowHeight;
          else if (
            (next + 1) * rowHeight >
            element.scrollTop + element.clientHeight
          )
            element.scrollTop = (next + 1) * rowHeight - element.clientHeight;
          setViewport({
            top: element.scrollTop,
            height: element.clientHeight || 600,
          });
          setFocusPath(target.path);
        }}
      >
        <div aria-hidden="true" style={{ height: window.start * rowHeight }} />
        {sheets.slice(window.start, window.end).map((sheet) => (
          <div
            className="sheetRowContainer"
            key={sheet.path}
            style={{ height: rowHeight }}
          >
            {selecting && (
              <label className="sheetCheck">
                <input
                  type="checkbox"
                  aria-label={`Select ${sheet.title}`}
                  disabled={!owned || pending || readOnlyPaths.has(sheet.path)}
                  checked={checked.has(sheet.path)}
                  onChange={(event) =>
                    setChecked((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(sheet.path);
                      else next.delete(sheet.path);
                      return next;
                    })
                  }
                />
              </label>
            )}
            <SheetRow
              sheet={sheet}
              active={sheet.path === selectedPath}
              pinned={preferences.pinned.includes(sheet.path)}
              draggable={owned && !pending && !selecting}
              disabled={pending}
              onOpen={() => onOpen(sheet.path)}
            />
          </div>
        ))}
        <div
          aria-hidden="true"
          style={{ height: (sheets.length - window.end) * rowHeight }}
        />
      </div>
    </>
  );
}
