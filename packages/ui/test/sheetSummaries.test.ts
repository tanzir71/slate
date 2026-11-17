import { expect, it, vi } from "vitest";
import { parseSheet } from "@slate/core";
import { createSheetSummaryCache } from "../src/browser/sheetSummaries";

it("parses only changed files, updates derived metadata and drops deleted paths", () => {
  const parse = vi.fn(parseSheet);
  const summarize = createSheetSummaryCache(parse);
  const files = [
    { path: "A.md", content: "# First\n\nWords #work" },
    { path: "B.md", content: "# Other" },
  ];
  const first = summarize(files);
  expect(parse).toHaveBeenCalledTimes(2);
  const refreshed = summarize(files.map((file) => ({ ...file })));
  expect(refreshed[0]).toBe(first[0]);
  expect(parse).toHaveBeenCalledTimes(2);
  const updated = summarize([
    { ...files[0]!, content: "# New title\n\nNew words #changed" },
    files[1]!,
  ]);
  expect(parse).toHaveBeenCalledTimes(3);
  expect(updated[0]?.title).toBe("New title");
  expect(updated[0]?.tags.map((tag) => tag.path)).toEqual(["changed"]);
  expect(updated[1]).toBe(first[1]);
  summarize([files[1]!]);
  summarize(files);
  expect(parse).toHaveBeenCalledTimes(4);
});
