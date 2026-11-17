import { parseSheet, type SheetDocument } from "@slate/core";

/** Reuse immutable summaries across keystrokes, refreshes and unrelated file edits. */
export function createSheetSummaryCache(parse = parseSheet) {
  let previous = new Map<string, SheetDocument>();
  return (sheets: readonly { path: string; content: string }[]) => {
    const next = new Map<string, SheetDocument>();
    const documents = sheets.map((sheet) => {
      const cached = previous.get(sheet.path);
      const document =
        cached?.raw === sheet.content
          ? cached
          : parse(sheet.content, sheet.path);
      next.set(sheet.path, document);
      return document;
    });
    previous = next;
    return documents;
  };
}
