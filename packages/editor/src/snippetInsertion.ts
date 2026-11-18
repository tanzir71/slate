import { snippet } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type ChangeSet,
  type Text,
} from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import type { SnippetField, renderSnippetTemplate } from "@slate/core";
import { markdownInputAllowed } from "./markdownInputContext.js";

export interface EditorSnippetRequest {
  readonly source: Text;
  readonly selection: EditorSelection;
  readonly from: number;
  readonly to: number;
}
type Expansion = Pick<
  ReturnType<typeof renderSnippetTemplate>,
  "text" | "fields"
>;
interface Session {
  readonly fields: readonly SnippetField[];
  readonly active: number;
}
const setSession = /* @__PURE__ */ StateEffect.define<Session | null>();

function fieldSelection(fields: readonly SnippetField[], index: number) {
  return EditorSelection.create(
    fields
      .filter((field) => field.index === index)
      .map((field) => EditorSelection.range(field.from, field.to)),
  );
}
function containsSelection(session: Session, selection: EditorSelection) {
  return selection.ranges.every((range) =>
    session.fields.some(
      (field) =>
        field.index === session.active &&
        range.from >= field.from &&
        range.to <= field.to,
    ),
  );
}

function mapSession(session: Session, changes: ChangeSet): Session {
  const active = session.fields.filter(
      (field) => field.index === session.active,
    ),
    activeByOrder = new Map(active.map((field) => [field.order, field])),
    ancestors = new Set(active.flatMap((field) => field.parents)),
    descendants = session.fields.flatMap((field) => {
      const parentOrder = field.parents.find((order) =>
        activeByOrder.has(order),
      );
      const parent =
        parentOrder === undefined ? undefined : activeByOrder.get(parentOrder);
      return field.index !== 0 && parent ? [{ field, parent }] : [];
    }),
    removed = new Set<number>();
  changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
    for (const { field, parent } of descendants) {
      if (
        from <= field.from &&
        to >= field.to &&
        (to > from || (parent.from === parent.to && inserted.length > 0))
      )
        removed.add(field.order);
    }
  });
  const fields = session.fields
    .filter((field) => !removed.has(field.order))
    .map((field): SnippetField => {
      const includesActive =
        field.index === session.active || ancestors.has(field.order);
      if (includesActive)
        return {
          ...field,
          from: changes.mapPos(field.from, -1),
          to: changes.mapPos(field.to, 1),
        };
      if (field.from === field.to) {
        const before = active.some(
          (item) => item.from === field.from && field.order < item.order,
        );
        const position = changes.mapPos(field.from, before ? -1 : 1);
        return { ...field, from: position, to: position };
      }
      const from = changes.mapPos(field.from, 1),
        to = changes.mapPos(field.to, -1);
      return { ...field, from: Math.min(from, to), to: Math.max(from, to) };
    });
  return { ...session, fields };
}

const snippetSession = /* @__PURE__ */ StateField.define<Session | null>({
  create: () => null,
  update(previous, transaction) {
    if (
      transaction.isUserEvent("undo") ||
      transaction.isUserEvent("redo") ||
      transaction.state.readOnly ||
      !transaction.state.facet(EditorView.editable)
    )
      return null;
    for (const effect of transaction.effects)
      if (effect.is(setSession)) return effect.value;
    if (!previous) return null;
    const next = transaction.docChanged
      ? mapSession(previous, transaction.changes)
      : previous;
    return containsSelection(next, transaction.newSelection) ? next : null;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (session) =>
      session
        ? Decoration.set(
            session.fields
              .filter((item) => item.index !== 0 && item.to > item.from)
              .map((item) =>
                Decoration.mark({ class: "cm-slateSnippetField" }).range(
                  item.from,
                  item.to,
                ),
              ),
            true,
          )
        : Decoration.none,
    ),
});

/** A picker or async variable prompt may only insert into its original snapshot. */
export function requestEditorSnippet(
  state: EditorState,
  from = state.selection.main.from,
): EditorSnippetRequest | undefined {
  const main = state.selection.main;
  if (
    state.readOnly ||
    !state.facet(EditorView.editable) ||
    state.selection.ranges.length !== 1 ||
    from < 0 ||
    from > main.from ||
    !markdownInputAllowed(state, from) ||
    !markdownInputAllowed(state, main.head)
  )
    return;
  return { source: state.doc, selection: state.selection, from, to: main.to };
}

/** Map rendered UTF-16 offsets through the public snippet() indentation rules. */
function indentedFields(
  state: EditorState,
  from: number,
  expansion: Expansion,
): SnippetField[] {
  const base = /^\s*/u.exec(state.doc.lineAt(from).text)![0],
    unit = state.facet(indentUnit);
  let sourceAt = 0,
    outputAt = from;
  const lines = expansion.text.split("\n").map((text, index) => {
    const tabs = index ? /^\t*/.exec(text)![0].length : 0,
      indent = index ? base.length : 0;
    const line = { sourceAt, outputAt, length: text.length, tabs, indent };
    sourceAt += text.length + 1;
    outputAt += text.length + indent + tabs * (unit.length - 1) + 1;
    return line;
  });
  const position = (offset: number) => {
    let low = 0,
      high = lines.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (offset <= lines[mid]!.sourceAt + lines[mid]!.length) high = mid;
      else low = mid + 1;
    }
    const line = lines[low]!;
    const column = offset - line.sourceAt;
    return (
      line.outputAt +
      line.indent +
      Math.min(column, line.tabs) * unit.length +
      Math.max(0, column - line.tabs)
    );
  };
  return expansion.fields.map((field) => ({
    ...field,
    from: position(field.from),
    to: position(field.to),
  }));
}

export function insertEditorSnippet(
  view: EditorView,
  request: EditorSnippetRequest,
  expansion: Expansion,
): boolean {
  const { state } = view;
  if (
    !view.dom.isConnected ||
    view.compositionStarted ||
    state.readOnly ||
    !state.facet(EditorView.editable) ||
    state.doc !== request.source ||
    !state.selection.eq(request.selection)
  )
    return false;
  const fields = indentedFields(state, request.from, expansion),
    active = Math.min(
      ...fields.filter((field) => field.index > 0).map((field) => field.index),
      Infinity,
    ),
    session = Number.isFinite(active) ? { fields, active } : null;
  // Selection normalization uses the starting state's facets. Configure linked
  // selections before the insertion transaction, without adding an undo entry.
  const configuration =
    state.field(snippetSession, false) === undefined
      ? state.update({
          effects: StateEffect.appendConfig.of(editorSnippetFields()),
        })
      : undefined;
  const configured = configuration?.state ?? state;
  // CodeMirror owns literal insertion and indentation. Its native field parser
  // cannot retain later stops after replacing a nested outer default, or parse
  // JSON braces in a default. Track rendered fields through public state APIs.
  snippet(expansion.text.replace(/[{}]/g, "\\$&"))(
    {
      state: configured,
      dispatch(transaction: Transaction) {
        const insertion = configured.update({
          changes: transaction.changes,
          selection: fieldSelection(fields, session?.active ?? 0),
          effects: setSession.of(session),
          annotations: [
            isolateHistory.of("full"),
            Transaction.userEvent.of("input.snippet"),
          ],
          scrollIntoView: true,
        });
        if (configuration) view.dispatch([configuration, insertion]);
        else view.dispatch(insertion);
      },
    },
    null,
    request.from,
    request.to,
  );
  return true;
}

export function moveEditorSnippetField(
  view: EditorView,
  direction: 1 | -1,
): boolean {
  const session = view.state.field(snippetSession, false);
  if (
    !session ||
    view.state.readOnly ||
    !view.state.facet(EditorView.editable) ||
    view.compositionStarted
  )
    return false;
  const indices = [...new Set(session.fields.map((field) => field.index))].sort(
    (a, b) => (a || Infinity) - (b || Infinity),
  );
  const next = indices[indices.indexOf(session.active) + direction];
  if (next === undefined) return false;
  view.dispatch({
    selection: fieldSelection(session.fields, next),
    effects: setSession.of(next === 0 ? null : { ...session, active: next }),
    scrollIntoView: true,
  });
  return true;
}
export function clearEditorSnippet(view: EditorView): boolean {
  if (!view.state.field(snippetSession, false)) return false;
  view.dispatch({ effects: setSession.of(null) });
  return true;
}
export function editorSnippetFields() {
  return [
    snippetSession,
    EditorState.allowMultipleSelections.of(true),
    Prec.highest(
      keymap.of([
        {
          key: "Tab",
          run: (view) => moveEditorSnippetField(view, 1),
          shift: (view) => moveEditorSnippetField(view, -1),
        },
        { key: "Escape", run: clearEditorSnippet },
      ]),
    ),
    EditorView.baseTheme({
      ".cm-slateSnippetField": {
        borderBottom: "1px dotted var(--slate-accent)",
      },
    }),
  ];
}
