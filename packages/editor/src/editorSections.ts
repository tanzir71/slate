import { isolateHistory } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { applyTextChanges, planMarkdownSectionMove, scanMarkdownSections } from "@slate/core";
import { editorSource, editorSourceEffect } from "./tidy.js";

const normalize = (source: string) => source.replace(/\r\n?/g, "\n");
const offset = (source: string, position: number) => normalize(source.slice(0, position)).length;

/** Capture only on an explicit outline action. The caller also guards file identity/revision. */
export function editorSectionTarget(view: EditorView, source: string, current: () => boolean) {
  const document = view.state.doc;
  const matches = () => current() && view.dom.isConnected && !view.state.readOnly &&
    view.state.facet(EditorView.editable) && !view.compositionStarted &&
    view.state.doc === document && editorSource(view.state) === source;
  if (!matches()) return;
  const sections = scanMarkdownSections(source);
  return {
    move(index: number, before: number): boolean {
      if (!matches() || !Number.isSafeInteger(index) || !Number.isSafeInteger(before) ||
        index < 0 || index >= sections.sections.length || before < 0 || before > sections.sections.length) return false;
      const plan = planMarkdownSectionMove(sections, index, before);
      if (!plan) return false;
      const output = applyTextChanges(source, plan.changes);
      view.dispatch({
        changes: plan.changes.map(({ from, to, text }) => ({ from: offset(source, from), to: offset(source, to), insert: normalize(text) })),
        selection: { anchor: offset(output, plan.selection.anchor), head: offset(output, plan.selection.head) },
        effects: editorSourceEffect(output),
        annotations: isolateHistory.of("full"),
        userEvent: "input.section.move",
        scrollIntoView: true,
      });
      // Live ownership/revision filters may reject the dispatched transaction.
      return editorSource(view.state) === output;
    },
  };
}
