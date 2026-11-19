import { invertedEffects, isolateHistory } from "@codemirror/commands";
import {
  StateEffect,
  StateField,
  Transaction,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { applyTextChanges } from "@slate/core";
import type { TidyResult } from "@slate/core/tidy";

const rawSource = StateEffect.define<string | undefined>();
const tidyLines = StateEffect.define<readonly number[]>();
const lineTints = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(previous, transaction) {
    if (transaction.docChanged) return Decoration.none;
    for (const effect of transaction.effects)
      if (effect.is(tidyLines)) {
        const lines = [...new Set(effect.value)]
          .filter(
            (line) =>
              Number.isSafeInteger(line) &&
              line > 0 &&
              line <= transaction.newDoc.lines,
          )
          .sort((a, b) => a - b);
        return Decoration.set(
          lines.map((line) =>
            Decoration.line({ class: "cm-tidy-line" }).range(
              transaction.newDoc.line(line).from,
            ),
          ),
        );
      }
    return previous;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const retainedSource = StateField.define<string | undefined>({
  create: () => undefined,
  update(previous, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(rawSource)) return effect.value;
    return transaction.docChanged ? undefined : previous;
  },
});
const normalize = (source: string) => source.replace(/\r\n?/g, "\n");
const retained = (source: string) =>
  source.includes("\r") ? source : undefined;

/** Retain raw EOL metadata only when needed, without adding whole-file snapshots per keystroke. */
export function tidyEditorHistory(initialSource: string): Extension {
  return [
    retainedSource.init(() => retained(initialSource)),
    lineTints,
    invertedEffects.of((transaction) => {
      const previous = transaction.startState.field(retainedSource);
      const changed = transaction.effects.some((effect) =>
        effect.is(rawSource),
      );
      return (transaction.docChanged || changed) &&
        (previous !== undefined || changed)
        ? [rawSource.of(previous)]
        : [];
    }),
  ];
}
export function editorSource(state: EditorState): string {
  return state.field(retainedSource, false) ?? state.doc.toString();
}
export function editorSourceEffect(
  source: string,
): StateEffect<string | undefined> {
  return rawSource.of(retained(source));
}
const normalizedOffset = (source: string, offset: number) =>
  normalize(source.slice(0, offset)).length;

export function editorTidyLines(
  lines: readonly number[],
): StateEffect<readonly number[]> {
  return tidyLines.of(lines);
}

/** Apply only a current, complete worker proposal; history carries exact raw bytes through undo/redo. */
export function applyEditorTidy(view: EditorView, result: TidyResult): boolean {
  if (view.state.readOnly || !view.dom.isConnected) return false;
  try {
    view.state.field(retainedSource);
  } catch {
    return false;
  }
  const source = editorSource(view.state);
  if (
    source !== result.source ||
    normalize(source) !== view.state.doc.toString() ||
    source === result.output ||
    !result.changes.length
  )
    return false;
  const changes = result.changes.map((change) => ({
    from: normalizedOffset(source, change.from),
    to: normalizedOffset(source, change.to),
    insert: normalize(change.text),
  }));
  try {
    if (applyTextChanges(source, result.changes) !== result.output)
      return false;
    if (
      view.state.changes(changes).apply(view.state.doc).toString() !==
      normalize(result.output)
    )
      return false;
  } catch {
    return false;
  }
  view.dispatch({
    changes,
    effects: editorSourceEffect(result.output),
    annotations: [
      isolateHistory.of("full"),
      Transaction.userEvent.of("input.tidy"),
    ],
  });
  return true;
}
