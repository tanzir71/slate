/** Metadata may lag text edits, but list actions require the current file identities. */
export function sheetStructureReady(
  files: readonly { path: string }[],
  summaries: readonly { path: string }[],
): boolean {
  if (files.length !== summaries.length) return false;
  const paths = new Set(summaries.map((sheet) => sheet.path));
  return (
    paths.size === summaries.length &&
    files.every((file) => paths.has(file.path))
  );
}
