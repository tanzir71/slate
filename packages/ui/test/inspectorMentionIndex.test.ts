import { expect, it, vi } from "vitest";
import { scanMarkdownMentionText } from "@slate/core";
import { createInspectorMentionIndex } from "../src/browser/inspectorMentionIndex";

const target = { id: "target", path: "target.md", title: "Launch plan", source: "# Launch plan" };
it("parses each changed eligible file once, excludes self/unsupported files and returns real source plans", () => {
  const scan = vi.fn(scanMarkdownMentionText), index = createInspectorMentionIndex(scan);
  const first = index({ id: 1, target, changed: [
    { path: target.path, content: target.source }, { path: "words.md", content: "Launch plan and LAUNCH PLAN" },
    { path: "code.md", content: "`Launch plan`" }, { path: "bad.md", content: "Launch plan", unsupportedEncoding: true },
  ], removed: [] });
  expect(first.reset).toBe(true); expect(first.changed.map(row => row.path)).toEqual(["words.md"]);
  expect(first.changed[0]!.plan.changes).toHaveLength(2); expect(scan).toHaveBeenCalledTimes(2);
  expect(first.changed[0]!.plan.source).toBe("Launch plan and LAUNCH PLAN");
  const ownEdit = index({ id: 2, target: { ...target, source: target.source + "\nMore" }, changed: [{ path: target.path, content: target.source + "\nMore" }], removed: [] });
  expect(ownEdit).toEqual({ id: 2, reset: false, changed: [], removed: [] }); expect(scan).toHaveBeenCalledTimes(2);
  const edit = index({ id: 3, target, changed: [{ path: "words.md", content: "Nothing" }], removed: [] });
  expect(edit.removed).toEqual(["words.md"]); expect(scan).toHaveBeenCalledTimes(3);
});

it("reuses semantic ranges for new targets and emits only deltas while the title remains unchanged", () => {
  const scan = vi.fn(scanMarkdownMentionText), index = createInspectorMentionIndex(scan);
  index({ id: 1, target, changed: [{ path: "a.md", content: "Launch plan and Other target" }, { path: "b.md", content: "Launch plan" }], removed: [] });
  expect(scan).toHaveBeenCalledTimes(2);
  const other = index({ id: 2, target: { ...target, path: "other.md", title: "Other target" }, changed: [], removed: [] });
  expect(other.reset).toBe(true); expect(other.changed.map(row => row.path)).toEqual(["a.md"]); expect(scan).toHaveBeenCalledTimes(2);
  expect(index({ id: 3, target: { ...target, path: "other.md", title: "Other target" }, changed: [], removed: ["a.md"] }).removed).toEqual(["a.md"]);
});
