import { Facet, type EditorState, type Text, type TransactionSpec } from "@codemirror/state";

export interface EditorHistoryReplacement {
  readonly changes: NonNullable<TransactionSpec["changes"]>;
  readonly selection: NonNullable<TransactionSpec["selection"]>;
  readonly userEvent: string;
}
export interface EditorHistoryDelegate {
  replaceLast(producer: EditorState, before: Text, replacement: EditorHistoryReplacement): boolean;
}
/** A view may delegate guarded smart-edit amendments to its retained history. */
export const editorHistoryDelegate = Facet.define<EditorHistoryDelegate, EditorHistoryDelegate | undefined>({ combine: (values) => values.at(-1) });
