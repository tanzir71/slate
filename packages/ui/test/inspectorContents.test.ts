import { expect, it } from "vitest";
import { parseSheet } from "@slate/core";
import { inspectorContents } from "../src/browser/inspectorContents";

it("does not scan the document or other links when the inspector is closed", () => {
  const selected = parseSheet("# Selected\n\nWords", "Selected.md");
  const other = parseSheet("[[Selected]]", "Other.md");
  Object.defineProperty(selected, "body", {
    get() {
      throw new Error("Hidden document body was scanned");
    },
  });
  Object.defineProperty(other, "links", {
    get() {
      throw new Error("Hidden backlinks were scanned");
    },
  });
  expect(inspectorContents(false, selected, [selected, other])).toEqual({
    outline: [],
    backlinks: [],
  });
});

it("shows the selected outline and incoming title or ID links without self-links", () => {
  const selected = parseSheet(
    "# Selected\n\n## Part two\n\n[[Selected]]",
    "Selected.md",
  );
  const byTitle = parseSheet("[[Selected|the sheet]]", "By title.md");
  const byId = {
    ...parseSheet("", "By id.md"),
    links: [{ targetId: selected.id, target: "", display: "selected" }],
  };
  const unrelated = parseSheet("[[Elsewhere]]", "Unrelated.md");
  expect(
    inspectorContents(true, selected, [selected, byTitle, byId, unrelated]),
  ).toEqual({
    outline: ["# Selected", "## Part two"],
    backlinks: [byTitle, byId],
  });
  const changed = parseSheet(
    "# Selected\n\n### Updated heading",
    "Selected.md",
  );
  expect(
    inspectorContents(true, changed, [changed, unrelated]).outline,
  ).toEqual(["# Selected", "### Updated heading"]);
});

it("has no outline or backlinks without a selected document", () => {
  const other = parseSheet("[[Selected]]", "Other.md");
  expect(inspectorContents(true, undefined, [other])).toEqual({
    outline: [],
    backlinks: [],
  });
});
