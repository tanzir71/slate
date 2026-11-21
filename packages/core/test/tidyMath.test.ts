import { expect, it } from "vitest";
import { fix, preservesContent, readTidyConfiguration, tidyRuleIds } from "../src/tidy/index";
import { isProtected, parseTidyDocument } from "../src/tidy/source";

it.each([
  ["Text $x  + y$.", "$x  + y$"],
  [String.raw`Text $a\$b$ tail.`, String.raw`$a\$b$`],
  ["\uFEFF---\r\ntitle: X\r\n---\r\n\r\n$$\r\nx  + y\r\n\r\nz\r\n$$\r\n", "$$\r\nx  + y\r\n\r\nz\r\n$$"],
  ["> $$\n> x\n>\n> y\n> $$", "$$\n> x\n>\n> y\n> $$"],
])("protects the exact physical TeX source: %j", (source, formula) => {
  const from = source!.indexOf(formula!), doc = parseTidyDocument(source!);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(isProtected(doc, from, from + formula!.length)).toBe(true);
  expect(doc.source).toBe(source);
});

it("keeps prices ordinary while protecting a later actual formula", () => {
  const source = "Costs $20 and $30; solve $x+y$.", doc = parseTidyDocument(source);
  expect(isProtected(doc, source.indexOf("20"), source.indexOf("20") + 2)).toBe(false);
  expect(isProtected(doc, source.indexOf("$x+y$"), source.indexOf("$x+y$") + 5)).toBe(true);
});

it.each([1, 2, 3, 4])("uses escape parity for dollar openers after %i backslashes", count => {
  const source = "\uFEFF---\r\ntitle: Literal\r\n---\r\n\r\nBefore " + "\\".repeat(count) + "$__word__$ after.\r\n";
  const doc = parseTidyDocument(source), escaped = count % 2 === 1;
  expect(doc.mathRanges.map(range => source.slice(range.from, range.to))).toEqual(escaped ? [] : ["$__word__$"]);
  const config = readTidyConfiguration(JSON.stringify({ version: 1,
    rules: Object.fromEntries(tidyRuleIds.map(id => [id, id === "strong-style"])) }));
  const result = fix(source, config);
  expect(result.output).toBe(escaped ? source.replace("__word__", "**word**") : source);
  expect(preservesContent(source, result.output)).toBe(true);
});

it("formats ordinary list markers while leaving formula punctuation unchanged", () => {
  const source = "* outside\n\n$$\n* alpha\n* beta\n$$\n";
  const config = readTidyConfiguration(JSON.stringify({ version: 1,
    rules: Object.fromEntries(tidyRuleIds.map(id => [id, id === "list-marker"])) }));
  const result = fix(source, config);
  expect(result.output).toBe(source.replace("* outside", "- outside"));
  expect(preservesContent(source, result.output)).toBe(true);
});

it.each([
  ["$$\n* alpha\n* beta\n$$", "$$\n- alpha\n- beta\n$$"],
  ["Text $x  + y$.", "Text $x + y$."],
])("the content guard rejects changes to literal formula source: %j", (before, after) => {
  expect(preservesContent(before!, after!)).toBe(false);
});
