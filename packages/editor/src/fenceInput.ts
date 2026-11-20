import { isolateHistory, undo } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import {
  Prec,
  type EditorSelection,
  type EditorState,
  type Text,
  type Transaction,
} from "@codemirror/state";
import { keymap, ViewPlugin, type EditorView } from "@codemirror/view";
import { insideEditorFrontmatter } from "./markdownInputContext.js";
import { editorHistoryDelegate } from "./documentHistory.js";

interface FencePlan {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly cursor: number;
  readonly languageAt?: number;
}
export interface EditorFenceRequest {
  readonly before: Text;
  readonly source: Text;
  readonly selection: EditorSelection;
  readonly plan: FencePlan;
}
export interface FenceInputOptions {
  readonly fences?: boolean;
  readonly frontmatter?: boolean;
  readonly onPickLanguage?: (
    view: EditorView,
    request: EditorFenceRequest,
  ) => void;
}

function frontmatterClosed(state: EditorState): boolean {
  for (let number = 2; number <= state.doc.lines; number++)
    if (/^(?:---|\.\.\.)[ \t]*$/.test(state.doc.line(number).text)) return true;
  return false;
}
function fencePlan(
  state: EditorState,
  options: FenceInputOptions,
): FencePlan | undefined {
  const selection = state.selection.main;
  if (state.readOnly || !selection.empty || state.selection.ranges.length !== 1)
    return;
  const line = state.doc.lineAt(selection.head);
  // No materialization or syntax work for an ordinary long paragraph.
  if (selection.head !== line.to || line.length > 128) return;
  const text = line.text;
  const base = { from: line.from, to: line.to };
  if (line.number === 1 && /^\uFEFF?---[ \t]*$/.test(text)) {
    if (options.frontmatter === false || frontmatterClosed(state)) return;
    return { ...base, insert: text + "\n\n---", cursor: text.length + 1 };
  }
  if (
    options.fences === false ||
    insideEditorFrontmatter(state, selection.head)
  )
    return;
  const match =
    /^([ \t]*(?:(?:>[ \t]*)|(?:(?:[-+*]|\d+[.)])[ \t]+))*)(\x60{3,}|~{3,})([^\r\n]*)$/.exec(
      text,
    );
  if (!match) return;
  const markerFrom = line.from + match[1]!.length;
  const tree = ensureSyntaxTree(state, line.to, 100);
  let node = tree?.resolveInner(markerFrom + 1, 1);
  while (node && node.name !== "FencedCode") node = node.parent ?? undefined;
  if (
    !node ||
    node.from !== markerFrom ||
    node.getChildren("CodeMark").length !== 1
  )
    return;
  const prefix = match[1]!.replace(/[-+*]|\d+[.)]/g, (marker) =>
    " ".repeat(marker.length),
  );
  const insert = text + "\n" + prefix + "\n" + prefix + match[2]!;
  return {
    ...base,
    insert,
    cursor: text.length + 1 + prefix.length,
    ...(!match[3]!.trim()
      ? { languageAt: match[1]!.length + match[2]!.length }
      : {}),
  };
}

export function enterEditorFence(
  view: EditorView,
  options: FenceInputOptions = {},
): boolean {
  if (view.compositionStarted) return false;
  const plan = fencePlan(view.state, options);
  if (!plan) return false;
  const before = view.state.doc;
  view.dispatch({
    changes: { from: plan.from, to: plan.to, insert: plan.insert },
    selection: { anchor: plan.from + plan.cursor },
    annotations: isolateHistory.of("full"),
    userEvent: "input.fence",
    scrollIntoView: true,
  });
  if (plan.languageAt !== undefined)
    options.onPickLanguage?.(view, {
      before,
      source: view.state.doc,
      selection: view.state.selection,
      plan,
    });
  return true;
}

/** Replace the guarded completed edit as one history event, regardless of picker delay. */
export function chooseEditorFenceLanguage(
  view: EditorView,
  request: EditorFenceRequest,
  language: string,
): boolean {
  const { plan } = request;
  if (
    !view.dom.isConnected ||
    view.state.readOnly ||
    view.compositionStarted ||
    view.state.doc !== request.source ||
    !view.state.selection.eq(request.selection) ||
    plan.languageAt === undefined ||
    !/^[a-zA-Z0-9_+#.-]{0,48}$/.test(language)
  )
    return false;
  if (!language) return true;
  const insert = plan.insert.slice(0, plan.languageAt) + language + plan.insert.slice(plan.languageAt);
  const delegated = view.state.facet(editorHistoryDelegate);
  if (delegated) {
    const accepted = delegated.replaceLast(view.state, request.before, { changes: { from: plan.from, to: plan.to, insert },
      selection: { anchor: plan.from + plan.cursor + language.length }, userEvent: "input.fence" });
    if (accepted) view.dispatch({ scrollIntoView: true });
    return accepted;
  }
  let restored: Transaction | undefined;
  undo({
    state: view.state,
    dispatch: (transaction) => {
      restored = transaction;
    },
  });
  if (!restored || !restored.state.doc.eq(request.before)) return false;
  const chosen = restored.state.update({
    changes: { from: plan.from, to: plan.to, insert },
    selection: { anchor: plan.from + plan.cursor + language.length },
    annotations: isolateHistory.of("full"),
    userEvent: "input.fence",
    scrollIntoView: true,
  });
  // Dispatch together so adapters observe only the combined final change.
  view.dispatch([restored, chosen]);
  return true;
}

export function createFenceInput(options: FenceInputOptions = {}) {
  const capture = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        const agent =
          view.dom.ownerDocument.defaultView?.navigator.userAgent ?? "";
        if (/Android\b/.test(agent) && /Chrome\//.test(agent))
          view.contentDOM.addEventListener("keydown", this.keydown, true);
      }
      keydown = (event: KeyboardEvent) => {
        if (
          event.key !== "Enter" ||
          event.defaultPrevented ||
          event.isComposing ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey ||
          this.view.compositionStarted
        )
          return;
        const { state } = this.view;
        const head = state.selection.main.head;
        const line = state.doc.lineAt(head);
        if (line.length > 128 || !/[\x60~]{3}|^\uFEFF?---/.test(line.text))
          return;
        // Android can swallow a rapid Enter before keymaps. Intercept only when
        // the live DOM and immutable source agree; leave pending IME/input alone.
        const selection = this.view.dom.ownerDocument.getSelection();
        const end = this.view.domAtPos(head);
        if (
          !selection?.isCollapsed ||
          selection.focusNode !== end.node ||
          selection.focusOffset !== end.offset
        )
          return;
        const element =
          end.node instanceof Element ? end.node : end.node.parentElement;
        if (element?.closest(".cm-line")?.textContent !== line.text) return;
        const start = this.view.domAtPos(line.from);
        const range = this.view.dom.ownerDocument.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        if (
          range.toString() !== line.text ||
          !enterEditorFence(this.view, options)
        )
          return;
        event.preventDefault();
      };
      destroy() {
        this.view.contentDOM.removeEventListener("keydown", this.keydown, true);
      }
    },
  );
  return [
    capture,
    Prec.highest(
      keymap.of([
        { key: "Enter", run: (view) => enterEditorFence(view, options) },
      ]),
    ),
  ];
}
