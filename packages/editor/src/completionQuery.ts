import type { EditorState } from "@codemirror/state";
import { markdownInputAllowed } from "./markdownInputContext.js";

export interface MarkdownCompletionQuery {
  readonly kind: "wiki" | "tag" | "date";
  readonly from: number;
  readonly contentFrom: number;
  readonly to: number;
  readonly query: string;
}

/** Bound lookback before inspecting syntax; ordinary text never scans the note. */
export function markdownCompletionQuery(
  state: EditorState,
): MarkdownCompletionQuery | undefined {
  const selection = state.selection.main;
  if (state.readOnly || !selection.empty || state.selection.ranges.length !== 1)
    return;
  const start = Math.max(0, selection.head - 131);
  const before = state.sliceDoc(start, selection.head);
  const wiki = /\[\[([^[\]\r\n|]{0,128})$/.exec(before);
  const tag = /#([A-Za-z0-9_/-]{0,128})$/.exec(before);
  const date = /@([A-Za-z0-9/-]{0,64})$/.exec(before);
  const match = wiki ?? tag ?? date;
  if (!match) return;
  const kind = wiki ? "wiki" : tag ? "tag" : "date";
  const from = start + match.index;
  const previous = from > 0 ? state.sliceDoc(from - 1, from) : "";
  if (
    kind === "wiki" ? previous === "[" : previous && !/[\s([>]/.test(previous)
  )
    return;
  if (kind === "tag" && match[1] && !/^[A-Za-z0-9]/.test(match[1])) return;
  if (!markdownInputAllowed(state, from, kind === "wiki" ? from : undefined))
    return;
  return {
    kind,
    from,
    contentFrom: from + (wiki ? 2 : 1),
    to: selection.head,
    query: match[1]!,
  };
}
