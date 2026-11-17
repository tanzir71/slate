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
  let result = source;
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index]!;
    result =
      result.slice(0, change.from) + change.text + result.slice(change.to);
  }
  return result;
}
