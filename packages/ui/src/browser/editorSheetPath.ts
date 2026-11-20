/** Narrow view targets; cache membership and disk checks remain separate authorities. */
export function isEditorSheetPath(path: string): boolean {
  return /\.md$/i.test(path) && !path.split(/[\\/]/).some((part) => !part || [".", "..", ".git", ".slate"].includes(part.toLowerCase()));
}
