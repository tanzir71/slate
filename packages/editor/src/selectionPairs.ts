import { isolateHistory } from "@codemirror/commands";
import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { inlineCodeDelimiters } from "./codeDelimiters.js";

interface PendingPair {
  character: string;
  selection: EditorSelection;
}
const setPending = StateEffect.define<PendingPair | undefined>();
const pendingPair = StateField.define<PendingPair | undefined>({
  create: () => undefined,
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setPending)) return effect.value;
    return transaction.docChanged || transaction.selection ? undefined : value;
  },
});

function delimiters(
  text: string,
  selected: string,
): readonly [string, string] | undefined {
  if (text === "[") return ["[", "]"];
  if (text === "(") return ["(", ")"];
  if (text === "~" || text === "~~") return ["~~", "~~"];
  if (text === "=" || text === "==") return ["==", "=="];
  if (text === "*" || text === "_") return [text, text];
  if (text !== "`") return;
  return inlineCodeDelimiters(selected);
}

/** Preserve every selected character and selection direction in one undo step. */
export function planSelectionPair(
  state: EditorState,
  text: string,
): Transaction | undefined {
  if (state.readOnly || state.selection.ranges.some((range) => range.empty))
    return;
  let supported = true;
  const changes = state.changeByRange((range) => {
    const pair = delimiters(text, state.sliceDoc(range.from, range.to));
    if (!pair) {
      supported = false;
      return { range };
    }
    return {
      changes: [
        { from: range.from, insert: pair[0] },
        { from: range.to, insert: pair[1] },
      ],
      range: EditorSelection.range(
        range.anchor + pair[0].length,
        range.head + pair[0].length,
      ),
    };
  });
  if (!supported) return;
  const character = text === "~" || text === "=" ? text : undefined;
  return state.update({
    ...changes,
    effects: setPending.of(
      character ? { character, selection: changes.selection } : undefined,
    ),
    annotations: isolateHistory.of("full"),
    userEvent: "input.pair",
    scrollIntoView: true,
  });
}

function consumeSecondCharacter(
  view: EditorView,
  character: string,
  reconcileDOM = false,
) {
  if (view.state.readOnly) return false;
  const pending = view.state.field(pendingPair, false);
  if (
    !pending ||
    pending.character !== character ||
    !pending.selection.eq(view.state.selection)
  )
    return false;
  const range = view.state.selection.main;
  view.dispatch({
    effects: setPending.of(undefined),
    ...(reconcileDOM
      ? {
          // A non-cancellable mobile input already changed the DOM. Reconcile it to
          // unchanged source, as CodeMirror does when skipping an inserted closer.
          changes: {
            from: range.from,
            to: range.to,
            insert: view.state.sliceDoc(range.from, range.to),
          },
          selection: view.state.selection,
          annotations: Transaction.addToHistory.of(false),
        }
      : {}),
  });
  return true;
}

export function createSelectionPairs(enabled = true): Extension {
  if (!enabled) return [];
  return [
    pendingPair,
    Prec.high(
      EditorView.domEventHandlers({
        keydown(event, view) {
          if (
            event.defaultPrevented ||
            event.isComposing ||
            view.compositionStarted ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          )
            return false;
          return consumeSecondCharacter(view, event.key);
        },
        beforeinput(event, view) {
          if (
            !event.cancelable ||
            event.isComposing ||
            view.compositionStarted ||
            event.inputType !== "insertText" ||
            !event.data
          )
            return false;
          return consumeSecondCharacter(view, event.data);
        },
      }),
    ),
    EditorView.inputHandler.of((view, from, to, text, insert) => {
      if (!/^(?:[*_`[(~=]|~~|==)$/.test(text) || view.compositionStarted)
        return false;
      const selection = view.state.selection.main;
      if (
        selection.from !== from ||
        selection.to !== to ||
        insert().annotation(Transaction.userEvent) !== "input.type"
      )
        return false;
      if (consumeSecondCharacter(view, text, true)) return true;
      const transaction = planSelectionPair(view.state, text);
      if (!transaction) return false;
      view.dispatch(transaction);
      return true;
    }),
  ];
}
