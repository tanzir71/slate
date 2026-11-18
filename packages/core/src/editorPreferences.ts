export interface SmartListPreferences {
  readonly continuation: boolean;
  readonly indent: boolean;
  readonly move: boolean;
}

export interface EditorPreferences {
  readonly version: 1;
  readonly smartLists: SmartListPreferences;
  readonly selectionPairs: boolean;
  readonly wikiCompletion: boolean;
  readonly tagCompletion: boolean;
  readonly dateCompletion: boolean;
}

export type EditorPreferenceRule =
  | keyof SmartListPreferences
  | "selectionPairs"
  | "wikiCompletion"
  | "tagCompletion"
  | "dateCompletion";

export const defaultEditorPreferences: EditorPreferences = Object.freeze({
  version: 1,
  smartLists: Object.freeze({ continuation: true, indent: true, move: true }),
  selectionPairs: true,
  wikiCompletion: true,
  tagCompletion: true,
  dateCompletion: true,
});

/** Optional preferences never prevent a document from opening. */
export function parseEditorPreferences(value: unknown): EditorPreferences {
  if (!record(value) || value.version !== 1 || !record(value.smartLists))
    return defaultEditorPreferences;
  const lists = value.smartLists;
  return {
    version: 1,
    selectionPairs:
      typeof value.selectionPairs === "boolean" ? value.selectionPairs : true,
    wikiCompletion:
      typeof value.wikiCompletion === "boolean" ? value.wikiCompletion : true,
    tagCompletion:
      typeof value.tagCompletion === "boolean" ? value.tagCompletion : true,
    dateCompletion:
      typeof value.dateCompletion === "boolean" ? value.dateCompletion : true,
    smartLists: {
      continuation:
        typeof lists.continuation === "boolean" ? lists.continuation : true,
      indent: typeof lists.indent === "boolean" ? lists.indent : true,
      move: typeof lists.move === "boolean" ? lists.move : true,
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
