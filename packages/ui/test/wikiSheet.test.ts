import { expect, it } from "vitest";
import { findWikiSheet } from "../src/browser/wikiSheet";

const sheets = [
  { path: "Work/Alpha.md", content: "# Shared\n\nFirst words." },
  { path: "Home/Alpha.md", content: "# Shared\n\nSecond words." },
];

it("resolves canonical paths to the intended file when headings are identical", () => {
  expect(
    findWikiSheet(sheets, { target: "Home/Alpha.md", targetId: undefined }),
  ).toBe(sheets[1]);
  expect(
    findWikiSheet(sheets, { target: "./Work/Alpha", targetId: undefined }),
  ).toBe(sheets[0]);
  expect(findWikiSheet(sheets, { target: "Shared", targetId: undefined })).toBe(
    sheets[0],
  );
  expect(sheets.map((sheet) => sheet.content)).toEqual([
    "# Shared\n\nFirst words.",
    "# Shared\n\nSecond words.",
  ]);
});

it("retains ID precedence, opens unreadable files by path and does not resolve traversal", () => {
  const id = "01J22222222222222222222222";
  const target = {
    path: "Moved.md",
    content: `---\nid: ${id}\n---\n# Renamed`,
  };
  const rows = [
    ...sheets,
    target,
    { path: "Bad.md", content: "", unsupportedEncoding: true },
  ];
  expect(
    findWikiSheet(rows, {
      target: sheets[0]!.path,
      targetId: id.toLowerCase(),
    }),
  ).toBe(target);
  expect(findWikiSheet(rows, { target: "Bad.md", targetId: undefined })).toBe(
    rows[3],
  );
  expect(
    findWikiSheet(rows, { target: "Bad", targetId: undefined }),
  ).toBeUndefined();
  expect(
    findWikiSheet(rows, { target: "../Home/Alpha.md", targetId: undefined }),
  ).toBeUndefined();
});
