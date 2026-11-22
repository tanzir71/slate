import { expect, it } from "vitest";
import { allocateImportPaths, createImportLinkResolver, portableImportName, relativeImportLink, rewriteImportMarkdown, validateImportSourcePath } from "../src/importPaths";

const one = "12345678123412341234123456789abc", two = "22345678-1234-1234-1234-123456789abc";
it("normalizes source separators, retains colon titles, and refuses traversal before allocation", () => {
  expect(validateImportSourcePath("Notes\\Meeting: kickoff.md")).toBe("Notes/Meeting: kickoff.md");
  for (const path of ["", "../outside.md", "/absolute.md", "C:/notes.md", "a/./b", "a/../b", "a//b", "a\0b"]) expect(() => validateImportSourcePath(path), path).toThrow("unsafe path");
  expect(() => allocateImportPaths([{ source: "a", target: "a" }, { source: "a/b.md", target: "a/b.md" }])).toThrow("file and folder");
  expect(() => allocateImportPaths([{ source: "a.md", target: "a.md" }, { source: "a.md", target: "b.md" }])).toThrow("Duplicate");
});
it("allocates portable collision-safe file and folder names after stripping Notion UUIDs", () => {
  const source = [`Page ${one}.md`, `Page ${two}.md`, `Page ${one}/Figure.png`, `Page ${two}/Figure.png`, "Meeting: kickoff.md", "CON.md", "a?.md", "a*.md"];
  const paths = allocateImportPaths(source.map(source => ({ source, target: source })), true);
  expect(paths.get(`Page ${one}.md`)).toBe("Page.md"); expect(paths.get(`Page ${two}.md`)).toBe("Page (2).md");
  expect(paths.get(`Page ${one}/Figure.png`)).toBe("Page/Figure.png"); expect(paths.get(`Page ${two}/Figure.png`)).toBe("Page (2)/Figure.png");
  expect(paths.get("Meeting: kickoff.md")).toBe("Meeting- kickoff.md"); expect(paths.get("CON.md")).toBe("_CON.md");
  expect(new Set(paths.values()).size).toBe(source.length);
  expect(portableImportName(" ")).toBe("Untitled"); expect(portableImportName("LPT².txt")).toBe("_LPT².txt");
  expect(portableImportName(".md")).toBe("Untitled.md"); expect(portableImportName(".slate")).toBe("_.slate");
  expect(new TextEncoder().encode(portableImportName("বাংলা".repeat(100))).length).toBeLessThanOrEqual(200);
  const image = portableImportName("বাংলা".repeat(100) + ".png");
  expect(image.endsWith(".png")).toBe(true); expect(new TextEncoder().encode(image).length).toBeLessThanOrEqual(200);
  expect(portableImportName("bad\ud800.md")).toBe("bad�.md");
});
it("fixes local references, escaped filenames, anchors and Notion URLs using the one allocation map", () => {
  const paths = new Map([[`Home ${one}.md`, "Home.md"], [`Home ${one}/Page ${two}.md`, "Home/Page.md"], [`Home ${one}/image (1).png`, "Home/image (1).png"]]);
  const resolve = createImportLinkResolver(paths, true);
  expect(resolve(`Home ${one}.md`, `Home%20${one}/Page%20${two}.md#heading`)).toBe("Home/Page.md#heading");
  expect(resolve(`Home ${one}/Page ${two}.md`, `../Home%20${one}.md?x=1#top`)).toBe("../Home.md?x=1#top");
  expect(resolve(`Home ${one}.md`, `https://www.notion.so/Page-${two}`)).toBe("Home/Page.md");
  for (const url of ["#here", "https://example.com/a", "//example.com/a", "mailto:a@example.com", "/absolute.md", "../../escape.md", "bad%XX.md", "unknown.md"]) expect(resolve(`Home ${one}.md`, url)).toBe(url);
  expect(relativeImportLink("A/note.md", "A/a (1).png")).toBe("a%20%281%29.png");
});
it("keeps collision suffixes inside the portable UTF-8 filename limit", () => {
  const name = "বাংলা".repeat(30), paths = allocateImportPaths([
    { source: "one.md", target: name + ".md" },
    { source: "two.md", target: name + ".md" },
    { source: "one/asset.png", target: name + "/asset.png" },
    { source: "two/asset.png", target: name + "/asset.png" },
  ]);
  expect(paths.get("two.md")).toMatch(/ \(2\)\.md$/);
  expect(paths.get("two/asset.png")).toMatch(/ \(2\)\/asset.png$/);
  for (const path of paths.values()) for (const part of path.split("/")) {
    expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(200);
    expect(portableImportName(part)).toBe(part);
  }
});
it("does not guess ambiguous Notion IDs", () => {
  const resolve = createImportLinkResolver(new Map([[`A ${one}.md`, "A.md"], [`B ${one}.md`, "B.md"]]), true);
  expect(resolve(`A ${one}.md`, `https://notion.so/${one}`)).toBe(`https://notion.so/${one}`);
});
it("changes only real Markdown destinations while preserving BOM, CRLF, metadata, code, titles and labels", () => {
  const raw = '\ufeff---\r\nvalue: "[literal](old.md)"\r\n---\r\n[**label**](old.md "Title") ![alt](<old.md>)\r\n\r\n[ref]: old.md "Ref title"\r\n\r\n`[code](old.md)`\r\n```md\r\n[code](old.md)\r\n```\r\n';
  expect(rewriteImportMarkdown(raw, url => url === "old.md" ? "new%20note.md" : url)).toBe(raw.replace('[**label**](old.md "Title")', '[**label**](new%20note.md "Title")').replace('![alt](<old.md>)', '![alt](<new%20note.md>)').replace('[ref]: old.md', '[ref]: new%20note.md'));
  expect(rewriteImportMarkdown("[a [nested] label](a(b).md)\\\n\n<https://example.com>", url => url === "a(b).md" ? "renamed.md" : url)).toBe("[a [nested] label](renamed.md)\\\n\n<https://example.com>");
  expect(rewriteImportMarkdown("Paragraph\n[ref]: old.md", () => "new.md")).toBe("Paragraph\n[ref]: old.md");
  expect(rewriteImportMarkdown("<https://notion.so/id>\n\nhttps://notion.so/id", () => "new.md")).toBe("[https://notion.so/id](new.md)\n\n[https://notion.so/id](new.md)");
});
