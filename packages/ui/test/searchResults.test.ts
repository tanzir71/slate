import { expect, it } from "vitest";
import { searchWorkspace } from "../src/search/searchResults";

it("searches all source and filenames while returning exact physical source offsets", () => {
  const source = "\uFEFF# One\r\n\r\nAlpha বাংলা\rAlpha\n";
  const result = searchWorkspace([{ path: "a.md", content: source }, { path: "Alpha.md", content: "Other" }], "alpha");
  expect(result).toMatchObject({ totalFiles: 2, totalMatches: 2, unsupportedFiles: 0 });
  expect(result.files[0]).toMatchObject({ path: "a.md", matches: 2, pathMatch: false });
  expect(result.files[1]).toMatchObject({ path: "Alpha.md", matches: 0, pathMatch: true, excerpts: [] });
  expect(result.files[0]!.excerpts[0]).toMatchObject({ from: 10, to: 15, line: 3, column: 1, text: "Alpha" });
  for (const match of result.files[0]!.excerpts) expect(source.slice(match.from, match.to)).toBe(match.text);
});
it("honors case and literal punctuation in both filenames and content", () => {
  const sheets = [{ path: "Alpha.md", content: "Alpha alpha a.*[x]" }];
  expect(searchWorkspace(sheets, "alpha", { matchCase: true })).toMatchObject({ totalMatches: 1 });
  expect(searchWorkspace(sheets, "alpha", { matchCase: true }).files[0]!.pathMatch).toBe(false);
  expect(searchWorkspace(sheets, "a.*[x]").files[0]!.excerpts[0]!.text).toBe("a.*[x]");
});
it("keeps all counts while bounding visible files and excerpts", () => {
  const result = searchWorkspace(Array.from({ length: 205 }, (_, index) => ({ path: `${index}.md`, content: "Alpha Alpha Alpha Alpha" })), "Alpha");
  expect(result.files).toHaveLength(200); expect(result.totalFiles).toBe(205); expect(result.totalMatches).toBe(820);
  expect(result.files.every((file) => file.matches === 4 && file.excerpts.length === 3)).toBe(true);
});
it("does not expose private metadata or non-Markdown files", () => {
  const sheets = [".slate/history/a.md", "Book/.SLATE/a.md", "Book\\.SLATE\\a.md", ".GIT/a.md", "image.svg", "book.MD"].map((path) => ({ path, content: "Alpha" }));
  expect(searchWorkspace(sheets, "Alpha").files.map((file) => file.path)).toEqual(["book.MD"]);
});
it("keeps unsupported file contents out of search but permits a filename result", () => {
  const result = searchWorkspace([{ path: "Alpha.md", content: "Alpha forged text", unsupportedEncoding: true }], "Alpha");
  expect(result).toMatchObject({ totalFiles: 1, totalMatches: 0, unsupportedFiles: 1 });
  expect(result.files[0]).toMatchObject({ unsupported: true, excerpts: [] });
});
it("clips surrounding context without splitting an astral character", () => {
  const result = searchWorkspace([{ path: "a.md", content: "🙂".repeat(40) + "xAlpha" + "y" + "🙂".repeat(40) }], "Alpha");
  const match = result.files[0]!.excerpts[0]!;
  expect(match.before.startsWith("🙂")).toBe(true); expect(match.after.endsWith("🙂")).toBe(true);
  expect(match).toMatchObject({ clippedBefore: true, clippedAfter: true, text: "Alpha" });
  expect(match.before.length).toBeLessThanOrEqual(61); expect(match.after.length).toBeLessThanOrEqual(61);
});
it("returns literal script-like source without creating markup and leaves blank queries empty", () => {
  const sheets = [{ path: "a.md", content: "<script>Alpha</script>" }];
  expect(searchWorkspace(sheets, "Alpha").files[0]!.excerpts[0]).toMatchObject({ before: "<script>", after: "</script>" });
  expect(searchWorkspace(sheets, "")).toEqual({ files: [], totalFiles: 0, totalMatches: 0, unsupportedFiles: 0 });
});
