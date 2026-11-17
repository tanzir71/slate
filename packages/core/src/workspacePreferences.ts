export interface WorkspacePreferences extends Record<string, unknown> {
  version: 1;
  pinned: string[];
  collapsedNotebooks: string[];
  density: "comfortable" | "compact";
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
  };
}
