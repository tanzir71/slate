import { evaluateSmartFilter, type SheetDocument } from "@slate/core";

export function matchesWorkspaceFilter(
  sheet: SheetDocument,
  filter: string,
  pinned: readonly string[],
  now?: Date,
): boolean {
  if (!filter) return true;
  if (filter === "@pinned") return pinned.includes(sheet.path);
  if (filter === "@drafts")
    return (
      sheet.frontmatter.status === "Draft" ||
      sheet.frontmatter.status === "draft"
    );
  if (filter === "@goals") return !!sheet.goal && !sheet.goal.complete;
  if (filter === "@recent")
    return evaluateSmartFilter(sheet, "modified:<7d", { now: now === undefined ? new Date() : now });
  if (filter.startsWith("#"))
    return sheet.tags.some(
      (tag) =>
        tag.path === filter.slice(1) ||
        tag.path.startsWith(`${filter.slice(1)}/`),
    );
  return sheet.path.startsWith(`${filter}/`);
}
