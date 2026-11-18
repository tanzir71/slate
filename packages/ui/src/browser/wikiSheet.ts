import { findWikiPath, parseSheet, type WikiLink } from "@slate/core";
import type { BrowserSheet } from "@slate/storage/browser-space";

export function findWikiSheet(sheets: readonly BrowserSheet[], link: Pick<WikiLink, "target" | "targetId">) {
  if (!link.targetId) {
    const path = findWikiPath(sheets, link.target);
    if (path) return path;
  }
  return sheets.find((sheet) => {
    if (sheet.unsupportedEncoding) return false;
    const parsed = parseSheet(sheet.content, sheet.path);
    return link.targetId ? parsed.id.toLowerCase() === link.targetId.toLowerCase() : parsed.title.toLowerCase() === link.target.toLowerCase();
  });
}
