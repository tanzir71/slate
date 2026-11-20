import { expect, it } from "vitest";
import { markdownHeadings, parseSheet } from "@slate/core";
import { inspectorContents, outlineMoveBefore } from "../src/browser/inspectorContents";

it("does not read document data or other links while closed, or without a selected sheet", () => {
  const selected = parseSheet("# Selected\n\nWords", "Selected.md"), other = parseSheet("[[Selected]]", "Other.md");
  for (const field of ["body", "raw", "headings"]) Object.defineProperty(selected, field, { get() { throw Error("Hidden document was scanned"); } });
  Object.defineProperty(other, "links", { get() { throw Error("Hidden backlinks were scanned"); } });
  expect(inspectorContents(false, selected, [selected, other])).toEqual({ outline: [], backlinks: [] });
  expect(inspectorContents(true, undefined, [other])).toEqual({ outline: [], backlinks: [] });
});

it("uses semantic root headings and physical offsets, excluding metadata, code, HTML and containers", () => {
  const source = "\uFEFF---\r\ntitle: Kept\n---\r\n\r\n# Selected *title*\r\n\r\n~~~md\n## Literal\n~~~\n\n> ## Quoted\n\n- ## Listed\n\n<div>\n## HTML\n</div>\n\nSetext\n------\n\n### বাংলা\n";
  const selected = parseSheet(source, "Selected.md"), { outline } = inspectorContents(true, selected, [selected]);
  expect(outline.map((heading) => [heading.label, heading.depth])).toEqual([["Selected title", 1], ["Setext", 2], ["বাংলা", 3]]);
  expect(outline[2]!.from).toBe(source.indexOf("### বাংলা"));
  expect(outline[2]!.line).toBe(source.slice(0, outline[2]!.from).match(/\r\n|\r|\n/g)!.length + 1);
});

it("reuses worker heading metadata without reading or parsing the selected source/body", () => {
  const selected = parseSheet("# Selected\n\n## Second", "Selected.md"), headings = markdownHeadings(selected.raw);
  Object.defineProperty(selected, "headings", { value: headings });
  for (const field of ["body", "raw"]) Object.defineProperty(selected, field, { get() { throw Error("Worker metadata was ignored"); } });
  const { outline } = inspectorContents(true, selected, [selected]);
  expect(outline[0]).toBe(headings[0]); expect(outline[1]).toBe(headings[1]);
});

it("resolves incoming paths, case-folded titles and IDs, returns real excerpts, and omits self-links", () => {
  const selected = parseSheet("# Selected\n\n[[Selected]]", "Folder/Selected.md");
  const byTitle = parseSheet("# Other title\n\nSee [[sELECTED|these words]] for scope.", "Other title.md");
  const byPath = parseSheet("[[Folder/Selected.md|Selected]] and [[Folder/Selected.md]].", "By path.md");
  const byId = { ...parseSheet("# By ID", "By id.md"), links: [{ raw: "[[id]]", targetId: selected.id.toUpperCase(), target: "", display: "Selected" }] };
  const unrelated = parseSheet("[[Elsewhere]]", "Unrelated.md");
  const result = inspectorContents(true, selected, [selected, byTitle, byPath, byId, unrelated]);
  expect(result.backlinks.map((link) => link.document)).toEqual([byTitle, byPath, byId]);
  expect(result.backlinks[0]!.snippet).toEqual({ before: "See ", label: "these words", after: " for scope." });
  expect(result.backlinks[1]!.snippet.label).toBe("Selected");
  expect(result.backlinks[1]!.count).toBe(2);
});

it("shows the actual linked sentence after a matching code example and counts only genuine occurrences", () => {
  const target = parseSheet("# Target", "target.md");
  const incoming = parseSheet("# Incoming\n\n`[[Target]]`\n\nSee [[Target]] for scope.\n\n[[Target]] again.", "incoming.md");
  const { backlinks } = inspectorContents(true, target, [target, incoming]);
  expect(backlinks).toHaveLength(1); expect(backlinks[0]!.count).toBe(2);
  expect(backlinks[0]!.snippet).toEqual({ before: "See ", label: "Target", after: " for scope." });
});

it("updates changed headings and backlinks from fresh immutable summaries", () => {
  const first = parseSheet("# First", "Selected.md"), other = parseSheet("[[First]]", "Other.md");
  expect(inspectorContents(true, first, [first, other]).backlinks).toHaveLength(1);
  const changed = parseSheet("# Updated\n\n### New heading", "Selected.md");
  const next = inspectorContents(true, changed, [changed, other]);
  expect(next.outline.map((heading) => heading.label)).toEqual(["Updated", "New heading"]); expect(next.backlinks).toHaveLength(0);
});

it("moves keyboard sections beside siblings while carrying children and respecting parent boundaries", () => {
  const outline = markdownHeadings("# Root\n## A\n### A1\n## B\n### B1\n## C\n# Other\n## D\n");
  expect(outlineMoveBefore(outline, 1, "up")).toBeUndefined();
  expect(outlineMoveBefore(outline, 1, "down")).toBe(5);
  expect(outlineMoveBefore(outline, 3, "up")).toBe(1);
  expect(outlineMoveBefore(outline, 3, "down")).toBe(6);
  expect(outlineMoveBefore(outline, 5, "down")).toBeUndefined();
  expect(outlineMoveBefore(outline, 2, "down")).toBeUndefined();
  expect(outlineMoveBefore(outline, 6, "up")).toBe(0);
  expect(outlineMoveBefore(outline, 0, "down")).toBe(8);
  expect(outlineMoveBefore(outline, -1, "up")).toBeUndefined();
});
