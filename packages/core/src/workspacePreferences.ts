import { templateOutputPath } from "./templatePath.js";

export interface WorkspacePreferences extends Record<string, unknown> {
  version: 1;
  pinned: string[];
  collapsedNotebooks: string[];
  density: "comfortable" | "compact";
  notebookTemplates?: Record<string, string>;
}

function readNotebookTemplates(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid workspace preference: notebookTemplates.");
  return Object.fromEntries(
    Object.entries(value).map(([notebook, reference]) => {
      if (typeof reference !== "string" || !reference.length)
        throw new Error("Invalid workspace preference: notebookTemplates.");
      return [notebook, reference];
    }),
  );
}

/** Exact notebook defaults never accidentally inherit Object.prototype entries. */
export function notebookTemplate(
  preferences: WorkspacePreferences,
  notebook: string,
): string | undefined {
  const defaults = preferences.notebookTemplates;
  return defaults && Object.hasOwn(defaults, notebook)
    ? defaults[notebook]
    : undefined;
}

export function withNotebookTemplate(
  preferences: WorkspacePreferences,
  notebook: string,
  reference: string | undefined,
): WorkspacePreferences {
  const suffix = "Untitled.md",
    path = templateOutputPath(notebook, "Untitled");
  if (path.slice(0, -suffix.length).replace(/\/$/, "") !== notebook)
    throw new Error("Use the notebook's canonical relative path.");
  if (reference !== undefined && !reference.length)
    throw new Error("Choose a template reference.");
  const defaults = Object.fromEntries(
    Object.entries(preferences.notebookTemplates ?? {}).filter(
      ([path]) => path !== notebook,
    ),
  );
  return {
    ...preferences,
    notebookTemplates:
      reference === undefined
        ? defaults
        : { ...defaults, [notebook]: reference },
  };
}

export function readWorkspacePreferences(
  value: unknown = { version: 1 },
): WorkspacePreferences {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("version" in value) ||
    value.version !== 1
  )
    throw new Error("Use workspace preferences version 1.");
  const source = value as Record<string, unknown>;
  const strings = (key: string): string[] => {
    const list = source[key];
    if (list === undefined) return [];
    if (
      !Array.isArray(list) ||
      !list.every(
        (entry: unknown) => typeof entry === "string" && entry.length > 0,
      )
    )
      throw new Error(`Invalid workspace preference: ${key}.`);
    return [...new Set(list as string[])];
  };
  if (
    source.density !== undefined &&
    source.density !== "comfortable" &&
    source.density !== "compact"
  )
    throw new Error("Invalid workspace preference: density.");
  return {
    ...source,
    version: 1,
    pinned: strings("pinned"),
    collapsedNotebooks: strings("collapsedNotebooks"),
    density: source.density ?? "comfortable",
    ...(source.notebookTemplates === undefined
      ? {}
      : { notebookTemplates: readNotebookTemplates(source.notebookTemplates) }),
  };
}
