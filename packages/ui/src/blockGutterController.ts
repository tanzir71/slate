import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  currentEditorBlock,
  editorBlockTarget,
  moveEditorBlock,
  type EditorBlockTarget,
} from "@slate/editor";

export interface BlockGutterRequest {
  kind: "insert" | "actions";
  view: EditorView;
  target: EditorBlockTarget;
  rect: { left: number; right: number; top: number; bottom: number };
}
const dragType = "application/x-slate-block";

/** All scanning and layout are pointer/action driven; typing only hides stale controls. */
export function createBlockGutterController(
  onRequest: (request: BlockGutterRequest) => void,
) {
  return ViewPlugin.fromClass(
    class {
      readonly controls = document.createElement("div");
      readonly access = document.createElement("button");
      target: EditorBlockTarget | undefined;
      drag: { target: EditorBlockTarget; token: string } | undefined;
      pending = 0;
      alive = true;
      constructor(readonly view: EditorView) {
        this.controls.className = "slateBlockGutter";
        this.controls.hidden = true;
        this.controls.setAttribute("role", "group");
        this.controls.setAttribute("aria-label", "Block controls");
        const plus = this.button("Insert block after", "+", "insert");
        const grip = this.button("Move or change block", "⠿", "actions");
        grip.draggable = true;
        grip.addEventListener("dragstart", (event) => {
          const target = this.target;
          if (
            !target ||
            target.index < 0 ||
            !currentEditorBlock(view, target) ||
            !event.dataTransfer
          ) {
            event.preventDefault();
            return;
          }
          const token = crypto.randomUUID();
          this.drag = { target, token };
          event.dataTransfer.setData(dragType, token);
          event.dataTransfer.effectAllowed = "move";
        });
        grip.addEventListener("dragend", () => {
          this.drag = undefined;
        });
        this.controls.append(plus, grip);
        this.access.type = "button";
        this.access.tabIndex = view.state.selection.main.empty ? 0 : -1;
        this.access.className = "slateBlockAccess";
        this.access.textContent = "⠿";
        this.access.setAttribute("aria-label", "Block actions");
        this.access.title = "Insert, move or change the current block";
        this.access.addEventListener("click", () => {
          const target = editorBlockTarget(view.state);
          if (target)
            onRequest({
              kind: "actions",
              view,
              target,
              rect: this.access.getBoundingClientRect(),
            });
        });
        view.dom.append(this.controls, this.access);
        this.access.hidden = view.state.readOnly;
      }
      button(label: string, glyph: string, kind: BlockGutterRequest["kind"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = glyph;
        button.setAttribute("aria-label", label);
        button.title = label;
        if (kind === "insert")
          button.addEventListener("mousedown", (event) =>
            event.preventDefault(),
          );
        button.addEventListener("click", () => {
          const target = this.target;
          if (target && currentEditorBlock(this.view, target))
            onRequest({
              kind,
              view: this.view,
              target,
              rect: button.getBoundingClientRect(),
            });
        });
        return button;
      }
      hide() {
        this.pending++;
        this.target = undefined;
        if (!this.controls.hidden) this.controls.hidden = true;
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          (update.selectionSet &&
            !update.state.selection.main.empty &&
            !this.drag) ||
          update.viewportChanged ||
          update.geometryChanged ||
          update.startState.readOnly !== update.state.readOnly
        )
          this.hide();
        if (update.docChanged || update.state.readOnly) this.drag = undefined;
        if (update.startState.readOnly !== update.state.readOnly)
          this.access.hidden = update.state.readOnly;
        if (
          update.startState.selection.main.empty !==
          update.state.selection.main.empty
        )
          this.access.tabIndex = update.state.selection.main.empty ? 0 : -1;
      }
      hover(event: MouseEvent) {
        const element =
          event.target instanceof Element ? event.target : undefined;
        if (element?.closest(".slateBlockGutter, .slateBlockAccess")) return;
        if (
          !element?.closest(".cm-line") ||
          this.view.state.readOnly ||
          this.view.compositionStarted
        ) {
          this.hide();
          return;
        }
        const sequence = ++this.pending;
        this.view.requestMeasure({
          key: this,
          read: (view) => {
            const position = view.posAtCoords({
              x: event.clientX,
              y: event.clientY,
            });
            const target =
              position === null
                ? undefined
                : editorBlockTarget(view.state, position);
            const rect = position === null ? null : view.coordsAtPos(position);
            const line = element.closest(".cm-line")?.getBoundingClientRect();
            if (!target || !rect || !line) return;
            const edge = view.dom.getBoundingClientRect();
            return {
              target,
              left: Math.max(edge.left + 2, line.left - 28),
              top: rect.top,
            };
          },
          write: (anchor) => {
            if (!this.alive || sequence !== this.pending) return;
            if (!anchor) {
              this.hide();
              return;
            }
            this.target = anchor.target;
            this.controls.style.left = `${anchor.left}px`;
            this.controls.style.top = `${anchor.top}px`;
            this.controls.hidden = false;
          },
        });
      }
      drop(event: DragEvent) {
        const drag = this.drag;
        if (!drag || event.dataTransfer?.getData(dragType) !== drag.token)
          return false;
        event.preventDefault();
        this.drag = undefined;
        const position = this.view.posAtCoords({
          x: event.clientX,
          y: event.clientY,
        });
        const target =
          position === null
            ? undefined
            : editorBlockTarget(this.view.state, position);
        const start = target ? this.view.coordsAtPos(target.block.from) : null;
        const end = target ? this.view.coordsAtPos(target.block.to) : null;
        const center = start && end ? (start.top + end.bottom) / 2 : undefined;
        const next = target?.document.blocks.findIndex(
          (block) => block.from >= target.position,
        );
        const before =
          target && target.index >= 0
            ? target.index +
              (center !== undefined && event.clientY >= center ? 1 : 0)
            : next !== undefined && next >= 0
              ? next
              : target?.document.blocks.length;
        queueMicrotask(() => {
          if (
            this.alive &&
            before !== undefined &&
            moveEditorBlock(this.view, drag.target, before)
          )
            this.view.focus();
        });
        return true;
      }
      destroy() {
        this.alive = false;
        this.drag = undefined;
        this.controls.remove();
        this.access.remove();
      }
    },
    {
      eventHandlers: {
        mousemove(event) {
          this.hover(event);
        },
        mouseleave(event) {
          if (
            !(event.relatedTarget instanceof Node) ||
            !this.controls.contains(event.relatedTarget)
          )
            this.hide();
        },
        scroll() {
          this.hide();
        },
        dragover(event) {
          if (!this.drag || !event.dataTransfer?.types.includes(dragType))
            return false;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          return true;
        },
        drop(event) {
          return this.drop(event);
        },
      },
    },
  );
}
