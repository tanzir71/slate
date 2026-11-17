export interface ReleaseNotes {
  version: string;
  title: string;
  changes: string[];
}

export function parseReleaseNotes(value: unknown): ReleaseNotes {
  if (typeof value !== "object" || value === null ||
    !("version" in value) || typeof value.version !== "string" || !value.version ||
    !("title" in value) || typeof value.title !== "string" ||
    !("changes" in value) || !Array.isArray(value.changes) ||
    !value.changes.every((change: unknown) => typeof change === "string")) {
    throw new Error("The release notes could not be read.");
  }
  return { version: value.version, title: value.title, changes: value.changes };
}
