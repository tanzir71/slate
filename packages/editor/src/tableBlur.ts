import { ensureSyntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import {
  EditorSelection,
  StateEffect,
  StateField,
  type ChangeDesc,
  type Extension,
} from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { formatMarkdownTable, type ParsedMarkdownTable } from "@slate/core";
import {
  editorTableAt,
  tablePoint,
  tablePosition,
  type EditorTable,
} from "./tableStructure.js";

const clearEditedTables = StateEffect.define<null>();
/** Composed position maps track edits without reading or parsing document text. */
const editedRanges = StateField.define<ChangeDesc | undefined>({
  create: () => undefined,
  update(value, transaction) {
    if (transaction.effects.some((effect) => effect.is(clearEditedTables)))
      return;
    if (!transaction.docChanged) return value;
    if (transaction.isUserEvent("input.table"))
      return value?.composeDesc(transaction.changes.desc);
    if (!transaction.isUserEvent("input") && !transaction.isUserEvent("delete"))
      return;
    return value
      ? value.composeDesc(transaction.changes.desc)
      : transaction.changes.desc;
  },
});

export function formatEditedTables(view: EditorView): boolean {
  const state = view.state,
    dirty = state.field(editedRanges, false);
  if (state.readOnly || view.compositionStarted || !dirty) return false;
  const tree = ensureSyntaxTree(state, state.doc.length, Infinity);
  if (!tree) return false;
  const found = new Map<
    number,
    { original: EditorTable; formatted: ParsedMarkdownTable }
  >();
  dirty.iterChangedRanges((_from, _to, from, to) => {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Table") return;
        const original = editorTableAt(state, node.from + 1);
        const formatted =
          original && formatMarkdownTable(original.parsed.table);
        if (
          original &&
          formatted &&
          original.parsed.source !== formatted.source
        )
          found.set(original.from, { original, formatted });
        return false;
      },
    });
  });
  const tables = [...found.values()].sort(
    (a, b) => a.original.from - b.original.from,
  );
  const changes = state.changes(
    tables.map(({ original, formatted }) => ({
      from: original.from,
      to: original.to,
      insert: formatted.source,
    })),
  );
  function position(value: number) {
    const table = tables.find(
      ({ original }) => value >= original.from && value <= original.to,
    );
    return table
      ? changes.mapPos(table.original.from, -1) +
          tablePosition(
            table.formatted,
            tablePoint(table.original.parsed, value - table.original.from),
          )
      : changes.mapPos(value);
  }
  view.dispatch({
    changes,
    selection: EditorSelection.create(
      state.selection.ranges.map((range) =>
        EditorSelection.range(position(range.anchor), position(range.head)),
      ),
      state.selection.mainIndex,
    ),
    effects: clearEditedTables.of(null),
    ...(changes.empty
      ? {}
      : { annotations: isolateHistory.of("full"), userEvent: "input.table" }),
  });
  return !changes.empty;
}

const protectedFocus = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest("dialog, [role='dialog'], .cm-tooltip, .selectionToolbar");
const formatOnBlur = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | undefined;
    constructor(readonly view: EditorView) {}
    blur(event: FocusEvent) {
      this.cancel();
      if (protectedFocus(event.relatedTarget)) return;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (
          this.view.dom.isConnected &&
          !this.view.hasFocus &&
          !protectedFocus(document.activeElement)
        )
          formatEditedTables(this.view);
      }, 0);
    }
    cancel() {
      if (this.timer !== undefined) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    }
    destroy() {
      this.cancel();
    }
  },
  {
    eventHandlers: {
      blur(event) {
        this.blur(event);
      },
      focus() {
        this.cancel();
      },
    },
  },
);
export const tableBlurFormatting: Extension = [editedRanges, formatOnBlur];
