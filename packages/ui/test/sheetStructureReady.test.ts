import { expect, it } from "vitest";
import { sheetStructureReady } from "../src/browser/sheetStructureReady";

it("accepts the same file identities regardless of ordering or changing source text", () => {
  const files = [
    { path: "A.md", content: "new words" },
    { path: "B.md", content: "updated" },
  ];
  const summaries = [
    { path: "B.md", content: "old words" },
    { path: "A.md", content: "older" },
  ];
  expect(sheetStructureReady(files, summaries)).toBe(true);
  expect(sheetStructureReady([], [])).toBe(true);
});

it("rejects an intermediate bulk-move snapshot with the right count and an obsolete path", () => {
  const files = [{ path: "Archive/A.md" }, { path: "Archive/B.md" }];
  expect(
    sheetStructureReady(files, [
      { path: "Archive/A.md" },
      { path: "Inbox/B.md" },
    ]),
  ).toBe(false);
  expect(sheetStructureReady(files, files)).toBe(true);
});

it("rejects missing, extra and duplicate identities", () => {
  const files = [{ path: "A.md" }, { path: "B.md" }];
  expect(sheetStructureReady(files, [{ path: "A.md" }])).toBe(false);
  expect(sheetStructureReady(files, [...files, { path: "C.md" }])).toBe(false);
  expect(sheetStructureReady(files, [{ path: "A.md" }, { path: "A.md" }])).toBe(
    false,
  );
});
