import type { SheetDocument } from "@slate/core";

export function inspectorContents(
  open: boolean,
  selected: SheetDocument | undefined,
  documents: readonly SheetDocument[],
) {
  if (!open || !selected) return { outline: [], backlinks: [] };
  return {
    outline: selected.body.split("\n").filter((line) => /^#{1,6} /.test(line)),
    backlinks: documents.filter(
      (sheet) =>
        sheet.path !== selected.path &&
        sheet.links.some(
          (link) =>
            link.targetId === selected.id || link.target === selected.title,
        ),
    ),
  };
}
