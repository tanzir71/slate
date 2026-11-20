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

interface LineEndings {
  readonly endings: readonly string[];
  readonly preferred: string;
}
const rawSource = StateEffect.define<LineEndings | undefined>();
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
function updateEndings(previous: LineEndings | undefined, transaction: Transaction): LineEndings | undefined {
  // Grouped history inverses run newest first, so the oldest snapshot wins.
  for (let index = transaction.effects.length - 1; index >= 0; index--) {
    const effect = transaction.effects[index];
    if (effect?.is(rawSource)) return effect.value;
  }
  if (!previous || !transaction.docChanged) return previous;
  const replacements: { from: number; to: number; count: number }[] = [];
  transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
    const first = transaction.startState.doc.lineAt(from).number - 1;
    const last = transaction.startState.doc.lineAt(to).number - 1;
    if (first !== last || inserted.lines > 1)
      replacements.push({ from: first, to: last, count: inserted.lines - 1 });
  });
  // Character edits retain the same small metadata reference in both state and history.
  if (!replacements.length) return previous;
  const endings: string[] = [];
  let cursor = 0;
  for (const change of replacements) {
    while (cursor < change.from) endings.push(previous.endings[cursor++]!);
    for (let line = 0; line < change.count; line++) endings.push(previous.preferred);
    cursor = change.to;
  }
  while (cursor < previous.endings.length) endings.push(previous.endings[cursor++]!);
  return { endings, preferred: previous.preferred };
}
const retainedSource = StateField.define<LineEndings | undefined>({
  create: () => undefined,
  update: updateEndings,
});
const normalize = (source: string) => source.replace(/\r\n?/g, "\n");
function retained(source: string): LineEndings | undefined {
  if (!source.includes("\r")) return undefined;
  const endings = source.match(/\r\n|\r|\n/g) ?? [];
  return { endings, preferred: endings[0] ?? "\r\n" };
}

/** Retain raw EOL metadata only when needed, without adding whole-file snapshots per keystroke. */
export function tidyEditorHistory(initialSource: string): Extension {
  return [
    retainedSource.init(() => retained(initialSource)),
    lineTints,
    invertedEffects.of((transaction) => {
      const previous = transaction.startState.field(retainedSource);
      return transaction.state.field(retainedSource) !== previous
        ? [rawSource.of(previous)]
        : [];
    }),
  ];
}
export function editorSource(state: EditorState): string {
  const metadata = state.field(retainedSource, false);
  if (!metadata) return state.doc.toString();
  const parts: string[] = [];
  const lines = state.doc.iterLines();
  let index = 0;
  while (!lines.next().done) {
    parts.push(lines.value);
    if (index < metadata.endings.length) parts.push(metadata.endings[index++]!);
  }
  return parts.join("");
}
export function editorSourceEffect(
  source: string,
): StateEffect<LineEndings | undefined> {
  return rawSource.of(retained(source));
}
/** Only source metadata belongs in a shared history; view configuration stays local. */
export function editorSourceEffects(transaction: Transaction): readonly StateEffect<unknown>[] {
  return transaction.effects.filter((effect) => effect.is(rawSource));
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
