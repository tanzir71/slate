import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export interface ToolbarRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface ToolbarSize {
  width: number;
  height: number;
}

/** Keep the entire toolbar inside the viewport and outside the selected lines. */
export function placeSelectionToolbar(
  selection: ToolbarRect,
  size: ToolbarSize,
  viewport: ToolbarRect,
): { left: number; top: number } | undefined {
  const gap = 8;
  if (selection.bottom <= viewport.top || selection.top >= viewport.bottom)
    return undefined;
  if (
    size.width > viewport.right - viewport.left - gap * 2 ||
    size.height > viewport.bottom - viewport.top - gap * 2
  )
    return undefined;
  const left = Math.max(
    viewport.left + gap,
    Math.min(
      (selection.left + selection.right - size.width) / 2,
      viewport.right - size.width - gap,
    ),
  );
  if (selection.top - size.height - gap >= viewport.top + gap)
    return { left, top: selection.top - size.height - gap };
  if (selection.bottom + size.height + gap <= viewport.bottom - gap)
    return { left, top: selection.bottom + gap };
  return undefined;
}

function equalRect(
  first: ToolbarRect | undefined,
  second: ToolbarRect | undefined,
) {
  return (
    first === second ||
    (!!first &&
      !!second &&
      first.left === second.left &&
      first.right === second.right &&
      first.top === second.top &&
      first.bottom === second.bottom)
  );
}

export function observeEditorSelection(
  onChange: (rect: ToolbarRect | undefined) => void,
  toolbar: () => HTMLElement | null,
): Extension {
  return ViewPlugin.fromClass(
    class {
      private last: ToolbarRect | undefined;
      constructor(private view: EditorView) {
        view.dom.ownerDocument.addEventListener("focusin", this.measure);
        window.addEventListener("scroll", this.measure, true);
        window.addEventListener("resize", this.measure);
        window.visualViewport?.addEventListener("resize", this.measure);
        window.visualViewport?.addEventListener("scroll", this.measure);
        this.measure();
      }
      update(update: ViewUpdate) {
        if (
          update.selectionSet ||
          update.docChanged ||
          update.viewportChanged ||
          update.focusChanged ||
          update.transactions.some((transaction) => transaction.reconfigured)
        )
          this.measure();
      }
      private read(): ToolbarRect | undefined {
        const view = this.view;
        const selection = view.state.selection.main;
        if (
          selection.empty ||
          view.state.readOnly ||
          (!view.hasFocus &&
            !toolbar()?.contains(view.dom.ownerDocument.activeElement))
        )
          return undefined;
        const first = view.coordsAtPos(selection.from, 1);
        const last = view.coordsAtPos(selection.to - 1, -1);
        if (!first || !last) return undefined;
        const bounds = view.scrollDOM.getBoundingClientRect();
        const rect = {
          left: Math.min(first.left, last.left),
          right: Math.max(first.right, last.right),
          top: Math.min(first.top, last.top),
          bottom: Math.max(first.bottom, last.bottom),
        };
        if (rect.top < bounds.top || rect.bottom > bounds.bottom)
          return undefined;
        return rect;
      }
      measure = () => {
        this.view.requestMeasure({
          key: this,
          read: () => this.read(),
          write: (rect) => {
            if (!equalRect(this.last, rect)) {
              this.last = rect;
              onChange(rect);
            }
          },
        });
      };
      destroy() {
        this.view.dom.ownerDocument.removeEventListener(
          "focusin",
          this.measure,
        );
        window.removeEventListener("scroll", this.measure, true);
        window.removeEventListener("resize", this.measure);
        window.visualViewport?.removeEventListener("resize", this.measure);
        window.visualViewport?.removeEventListener("scroll", this.measure);
      }
    },
  );
}
