import { Prec, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorBlockQuery, type BlockQuery } from "@slate/editor";

export interface BlockMenuAnchor extends BlockQuery {
  view: EditorView;
  rect: { left: number; right: number; top: number; bottom: number };
}

/** Measure only an open menu. Ordinary writing does not cross into React. */
export function createBlockMenuController(
  onChange: (anchor: BlockMenuAnchor | undefined) => void,
  onKey: (event: KeyboardEvent, view: EditorView, query: BlockQuery) => boolean,
) {
  const plugin = ViewPlugin.fromClass(
    class {
      query: BlockQuery | undefined;
      dismissed = "";
      alive = true;
      prepared: { from: number; rect: BlockMenuAnchor["rect"] } | undefined;
      constructor(readonly view: EditorView) {}
      update(update: ViewUpdate) {
        if (update.viewportChanged && !update.docChanged)
          this.prepared = undefined;
        if (update.docChanged || update.selectionSet) this.dismissed = "";
        if (
          update.docChanged ||
          update.selectionSet ||
          this.query ||
          update.startState.readOnly !== update.state.readOnly
        )
          this.refresh();
      }
      refresh() {
        const query = editorBlockQuery(this.view.state);
        if (!query || JSON.stringify(query) === this.dismissed) {
          if (this.query) {
            this.query = undefined;
            onChange(undefined);
          }
          return;
        }
        if (
          !this.view.hasFocus &&
          !document.activeElement?.closest(".slateBlockMenu")
        )
          return;
        this.query = query;
        const prepared = this.prepared;
        if (prepared?.from === query.from) {
          queueMicrotask(() => {
            if (this.alive && this.query === query)
              onChange({ ...query, view: this.view, rect: prepared.rect });
          });
        }
        this.view.requestMeasure({
          key: this,
          read: (view) => view.coordsAtPos(query.from),
          write: (rect) => {
            if (rect && this.alive && this.query === query) {
              this.prepared = { from: query.from, rect };
              if (
                !prepared ||
                prepared.rect.left !== rect.left ||
                prepared.rect.top !== rect.top ||
                prepared.rect.bottom !== rect.bottom
              )
                onChange({ ...query, view: this.view, rect });
            }
          },
        });
      }
      close() {
        this.dismissed = JSON.stringify(this.query);
        this.query = undefined;
        this.prepared = undefined;
        onChange(undefined);
      }
      destroy() {
        this.alive = false;
        onChange(undefined);
      }
    },
    {
      eventHandlers: {
        beforeinput(event) {
          // Capture the insertion anchor before the slash changes the DOM. No
          // geometry is read for ordinary text, code formatting or navigation.
          if (
            event.data?.startsWith("/") &&
            this.view.state.selection.main.empty &&
            !this.view.state.readOnly
          ) {
            const from = this.view.state.selection.main.head;
            const rect = this.view.coordsAtPos(from);
            if (rect) this.prepared = { from, rect };
          }
        },
        focus() {
          this.refresh();
        },
        blur(event) {
          if (
            !(event.relatedTarget instanceof Element) ||
            !event.relatedTarget.closest(".slateBlockMenu")
          )
            this.close();
        },
        scroll() {
          this.prepared = undefined;
          if (this.query) this.refresh();
        },
      },
    },
  );
  const keys = Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        const query = view.plugin(plugin)?.query;
        if (!query || event.isComposing || view.composing) return false;
        if (!onKey(event, view, query)) return false;
        event.preventDefault();
        return true;
      },
    }),
  );
  return {
    extension: [plugin, keys] as Extension,
    close(view: EditorView) {
      view.plugin(plugin)?.close();
    },
  };
}
