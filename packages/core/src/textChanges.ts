export interface TextChange {
  from: number;
  to: number;
  text: string;
}

/** Coordinates refer to the same original document, as in an editor transaction. */
export function applyTextChanges(
  source: string,
  changes: readonly TextChange[],
): string {
  validateTextChanges(source, changes);
  let result = source;
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index]!;
    result =
      result.slice(0, change.from) + change.text + result.slice(change.to);
  }
  return result;
}

/** Check every output span without allocating another full-document string. */
export function matchesTextChanges(
  source: string,
  changes: readonly TextChange[],
  result: string,
): boolean {
  validateTextChanges(source, changes);
  let length = source.length;
  for (const change of changes)
    length += change.text.length - (change.to - change.from);
  if (length !== result.length) return false;
  let sourceOffset = 0;
  let resultOffset = 0;
  for (const change of changes) {
    const unchanged = source.slice(sourceOffset, change.from);
    if (!result.startsWith(unchanged, resultOffset)) return false;
    resultOffset += unchanged.length;
    if (!result.startsWith(change.text, resultOffset)) return false;
    resultOffset += change.text.length;
    sourceOffset = change.to;
  }
  return result.endsWith(source.slice(sourceOffset));
}

function validateTextChanges(source: string, changes: readonly TextChange[]) {
  let previousEnd = 0;
  for (const change of changes) {
    if (
      !Number.isSafeInteger(change.from) ||
      !Number.isSafeInteger(change.to) ||
      change.from < previousEnd ||
      change.to < change.from ||
      change.to > source.length ||
      typeof change.text !== "string"
    )
      throw new Error("Invalid recovery text changes.");
    previousEnd = change.to;
  }
}
