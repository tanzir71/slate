import { expect, it, vi } from "vitest";
import { markdownHeadings } from "../src/markdownHeadings";
import * as markdown from "../src/blocks";

it("avoids full Markdown parsing when a 50k-word body has no possible heading marker", () => {
  const parse = vi.spyOn(markdown, "parseMarkdownPreview");
  try {
    const paragraph = Array.from({ length: 100 }, (_, value) => `word${value}`).join(" ");
    const body = Array.from({ length: 500 }, () => paragraph).join("\r\n\r\n");
    expect(markdownHeadings(body)).toEqual([]);
    expect(markdownHeadings(`\uFEFF---\r\ntitle: Headingless\r\n---\r\n${body}`)).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  } finally { parse.mockRestore(); }
});

it("keeps exact BOM/CRLF source offsets and physical lines after front matter", () => {
  const source = "\uFEFF---\r\ntitle: Kept\r\n---\r\n\r\n## *Goals* and `code`\r\n\r\nNext\r\n====\r\n";
  const headings = markdownHeadings(source);
  expect(headings).toEqual([
    { label: "Goals and code", depth: 2, from: source.indexOf("##"), to: source.indexOf("\r\n", source.indexOf("##")), line: 5, root: true },
    { label: "Next", depth: 1, from: source.indexOf("Next"), to: source.indexOf("====") + 4, line: 7, root: true },
  ]);
  expect(source.slice(headings[1]!.from, headings[1]!.to)).toBe("Next\r\n====");
});
it("includes real nested headings and ignores fenced/indented code and raw HTML", () => {
  const source = "# Root\n\n```md\n# Fenced\n```\n\n    # Indented\n\n<div>\n# HTML\n</div>\n\n> ## Quoted\n\n- ### Listed\n";
  expect(markdownHeadings(source).map(({ label, depth, root }) => ({ label, depth, root }))).toEqual([
    { label: "Root", depth: 1, root: true }, { label: "Quoted", depth: 2, root: false }, { label: "Listed", depth: 3, root: false },
  ]);
});
it("retains duplicate names, inline text and Unicode without confusing UTF-8 bytes with UTF-16 offsets", () => {
  const source = "Intro 🙂\r\n\r\n# বাংলা\r\n\r\n## **বাংলা**\r\n\r\n### [Link](https://example.test) ![Picture](image.png)\r\n";
  const headings = markdownHeadings(source);
  expect(headings.map((heading) => heading.label)).toEqual(["বাংলা", "বাংলা", "Link Picture"]);
  expect(headings[0]).toMatchObject({ from: source.indexOf("#"), line: 3 });
  expect(headings[1]!.from).toBeGreaterThan(headings[0]!.from);
});
it("does not turn headings in an unfinished code fence or a front-matter field into navigation targets", () => {
  expect(markdownHeadings("---\ntitle: '# Hidden'\n---\n\n~~~md\n# Not a heading\n")).toEqual([]);
});
