import { expect, it } from "vitest";
import { extractWikiLinks, parseSheet } from "../src/index";

it("counts real wiki references while excluding code, HTML, escaped syntax and ordinary Markdown links/images", () => {
  const source = "[[Real]]\n\n`[[Code]]`\n\n~~~md\n[[Fence]]\n~~~\n\n    [[Indented]]\n\n<div>\n[[HTML]]\n</div>\n\n<span>[[Inline HTML]]</span>\n\n\\[[Escaped]]\n\n[ordinary [[Nested]]](url)\n\n![image [[Alt]]](asset.png)\n";
  expect(extractWikiLinks(source).map(link => link.target)).toEqual(["Real"]);
});
it("retains physical body offsets and aliases after identical literal examples", () => {
  const body = "🚀 `[[Target]]`\r\n\r\nSee [[Target]] and [[folder/note.md|**Label**]].\r\n";
  const links = extractWikiLinks(body);
  expect(links.map(link => [link.target, link.from, link.to])).toEqual([
    ["Target", body.indexOf("[[Target]]", body.indexOf("See")), body.indexOf("[[Target]]", body.indexOf("See")) + 10],
    ["folder/note.md", body.indexOf("[[folder"), body.indexOf("[[folder") + "[[folder/note.md|**Label**]]".length],
  ]);
  expect(links[1]!.display).toBe("**Label**");
});
it("keeps metadata out of parsed sheet links and ignores multiline wiki tokens", () => {
  const sheet = parseSheet("---\ntitle: '[[Metadata]]'\n---\n\n[[Body]]\n\n[[Across\nlines]]", "note.md");
  expect(sheet.links.map(link => link.target)).toEqual(["Body"]);
});
