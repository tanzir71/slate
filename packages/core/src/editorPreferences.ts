export interface SmartListPreferences {
  readonly continuation: boolean;
  readonly indent: boolean;
  readonly move: boolean;
}

export interface EditorPreferences {
  readonly version: 1;
  readonly smartLists: SmartListPreferences;
}

export const defaultEditorPreferences: EditorPreferences = Object.freeze({
  version: 1,
  smartLists: Object.freeze({ continuation: true, indent: true, move: true }),
});

/** Optional preferences never prevent a document from opening. */
export function parseEditorPreferences(value: unknown): EditorPreferences {
  if (!record(value) || value.version !== 1 || !record(value.smartLists))
    return defaultEditorPreferences;
  const lists = value.smartLists;
  return {
    version: 1,
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
