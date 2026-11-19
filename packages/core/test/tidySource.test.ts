import { expect, it } from "vitest";
import { isProtected, lineAt, parseTidyDocument } from "../src/tidy/source";

it("maps UTF-16 source offsets through BOM, front matter and every physical line ending", () => {
  const source = "\uFEFF---\r\ntitle: A\r\n---\r\n# বাংলা 🙂\r\n\r\nLast\r";
  const doc = parseTidyDocument(source);
  expect(doc.eol).toBe("\r\n");
  expect(doc.body).toBe("# বাংলা 🙂\r\n\r\nLast\r");
  expect(doc.lines.map((line) => line.text)).toEqual([
    "\uFEFF---",
    "title: A",
    "---",
    "# বাংলা 🙂",
    "",
    "Last",
    "",
  ]);
  for (const line of doc.lines) {
    expect(lineAt(doc, line.from)).toBe(line);
    expect(source.slice(line.from, line.to)).toBe(line.text);
  }
  expect(isProtected(doc, 0, doc.bodyFrom)).toBe(true);
  expect(lineAt(doc, source.length).index).toBe(6);
});
it("protects code, raw HTML and wiki source while retaining ordinary Markdown nodes for rules", () => {
  const source =
    "# Heading\n\n`inline  code` and [[Two  spaces]]\n\n```txt\ncode\tword\n```\n\n<div>raw\tvalue</div>\n";
  const doc = parseTidyDocument(source);
  for (const token of ["inline", "Two  spaces", "code\tword", "raw\tvalue"]) {
    const at = source.indexOf(token);
    expect(isProtected(doc, at, at + token.length)).toBe(true);
  }
  expect(isProtected(doc, 0, 9)).toBe(false);
  expect(doc.visits.some(({ node }) => node.type === "heading")).toBe(true);
});
it("keeps empty and unfinished documents inspectable without assuming an LF", () => {
  expect(parseTidyDocument("").lines).toHaveLength(1);
  expect(parseTidyDocument("one\rtwo").lines.map((line) => line.text)).toEqual([
    "one",
    "two",
  ]);
  const doc = parseTidyDocument("---\nx: [unfinished");
  expect(doc.body).toBe("");
  expect(isProtected(doc, 0, doc.source.length)).toBe(true);
});
