import { expect, it } from "vitest";
import { parseSheet, serializeSheet } from "../src/index";
import { markdownBodyFrom } from "../src/markdownBody";

it.each(["\n", "\r\n", "\r"])("reads BOM metadata without rewriting physical %j line endings", (eol) => {
  const body = "# Body" + eol + eol + "Words kept." + eol;
  const raw = "\uFEFF" + ["---", "id: kept-id", "title: Metadata title", "tags: [work/research]", "updated: 2026-11-18", "---", body].join(eol);
  const document = parseSheet(raw, "Notes/Original.md");
  expect(document.id).toBe("kept-id"); expect(document.title).toBe("Metadata title");
  expect(document.tags.map((tag) => tag.path)).toContain("work/research");
  expect(document.updatedAt).toBeInstanceOf(Date);
  expect(document.body).toBe(body); expect(document.raw).toBe(raw); expect(serializeSheet(document)).toBe(raw);
  expect(raw.slice(markdownBodyFrom(raw))).toBe(body);
});
it.each(["---", "...", "--- \t"])("shares the protected-header boundaries for empty metadata closed by %s", (closing) => {
  const body = "# Body\r\n\r\nWords kept.\r\n";
  const raw = "\uFEFF--- \t\r\n" + closing + "\r\n" + body;
  const document = parseSheet(raw, "Empty.md");
  expect(document.frontmatter).toEqual({}); expect(document.body).toBe(body); expect(document.title).toBe("Body");
  expect(serializeSheet(document)).toBe(raw); expect(raw.slice(markdownBodyFrom(raw))).toBe(body);
});
it("does not mistake an encoding marker for body text or lose it on serialization", () => {
  const raw = "\uFEFF# Named sheet\r\n\r\nWords kept.\r\n";
  const document = parseSheet(raw, "Fallback.md");
  expect(document.title).toBe("Named sheet"); expect(document.body).toBe(raw.slice(1)); expect(serializeSheet(document)).toBe(raw);
});
it.each([false, true])("keeps malformed YAML readable and allows the next file's metadata to be derived (BOM %s)", (bom) => {
  const bad = (bom ? "\uFEFF" : "") + "---\r\ntitle: [unfinished\r\n---\r\n# Body\r\n\r\nWords kept.\r\n";
  const good = "---\nid: next-id\ntitle: Next\n---\n# Actual body\n";
  const documents = [bad, good].map((raw, index) => parseSheet(raw, `${index}.md`));
  expect(documents[0]?.frontmatter).toEqual({}); expect(documents[0]?.body).toBe(bad.replace(/^\uFEFF/, ""));
  expect(documents[0]?.title).toBe("Body"); expect(documents[1]?.id).toBe("next-id");
  expect(documents.map(serializeSheet)).toEqual([bad, good]);
});
it("keeps an unfinished metadata region protected while retaining every raw character", () => {
  const raw = "\uFEFF---\r\ntitle: [unfinished\r\n# Still protected\r\n";
  expect(markdownBodyFrom(raw)).toBe(raw.length);
  expect(serializeSheet(parseSheet(raw, "Draft.md"))).toBe(raw);
});
