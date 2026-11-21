import { expect, it } from "vitest";
import * as fc from "fast-check";
import { fix, preservesContent } from "../src/tidy/index";
import { createTidyContentGuard, projectTidyDocument } from "../src/tidy/projection";
import { parseTidyDocument, type TidyDocument, type TidyNode } from "../src/tidy/source";
import { comparePlainTidyAst } from "../src/tidy/structuralProof";

function reference(before: TidyDocument, after: TidyDocument): boolean {
  try { return projectTidyDocument(before) === projectTidyDocument(after); }
  catch { return false; }
}
function guarded(before: TidyDocument, after: TidyDocument): boolean {
  try { return createTidyContentGuard(before)(after); }
  catch { return false; }
}
function withRoot(root: unknown): TidyDocument {
  // Exercise runtime/unknown AST shapes beyond the parser's static node type.
  return { ...parseTidyDocument("Words.\n"), root: root as TidyNode };
}
const text = (value: string) => ({ type: "text", value });
const paragraph = (value: string) => ({ type: "paragraph", children: [text(value)] });
const root = (value: string) => ({ type: "root", children: [paragraph(value)] });

it("proves ordinary list repairs without sorting keys for every AST node", () => {
  const source = Array(500).fill("+ one two three four five six seven eight nine ten").join("\n") + "\n";
  const original = Array.prototype.sort;
  let astKeySorts = 0;
  Array.prototype.sort = function (this: unknown[], compare?: (left: unknown, right: unknown) => number) {
    if (this.includes("type") && this.every(value => typeof value === "string")) astKeySorts++;
    return Reflect.apply(original, this, [compare]) as unknown[];
  };
  let result: ReturnType<typeof fix> | undefined;
  try { result = fix(source); } finally { Array.prototype.sort = original; }
  expect(result?.output).toBe(source.replaceAll("+", "-"));
  expect(result?.rejected).toEqual([]);
  expect(preservesContent(source, result!.output)).toBe(true);
  // Keep the complete word proof; bound allocations instead of a unit clock.
  expect(astKeySorts).toBeLessThanOrEqual(2);
});

it("matches the serialized proof across generated ordinary trees and successive candidates", () => {
  const line = fc.array(fc.constantFrom("one", "two", "word42", "বাক্য", "𐐀", "é"), { minLength: 1, maxLength: 8 }).map(words => words.join(" "));
  fc.assert(fc.property(
    fc.array(line, { minLength: 1, maxLength: 12 }), fc.boolean(), fc.constantFrom("\n", "\r\n", "\r"),
    fc.constantFrom("", "\uFEFF", "---\ntitle: Kept\n---\n\n", "\uFEFF---\na: &same Words\nb: *same\n---\n\n"),
    (lines, list, eol, prefix) => {
      const heading = prefix.replaceAll("\n", eol), body = lines.map(value => (list ? "+ " : "") + value).join(list ? eol : eol + eol) + eol;
      const source = heading + body, before = parseTidyDocument(source), guard = createTidyContentGuard(before);
      const candidates = [source, heading + body.replace(/^\+/gm, "-"), heading + body.replace(lines[0]!.split(" ")[0]!, "Changed"),
        source.startsWith("\uFEFF") ? source.slice(1) : "\uFEFF" + source, source + "`literal  words`" + eol, heading + body.replaceAll(" ", "  "), source];
      for (const candidate of candidates) {
        const after = parseTidyDocument(candidate);
        expect(guard(after)).toBe(reference(before, after));
      }
    },
  ), { seed: 2026112102, numRuns: 300 });
}, 30_000);

it("retains unknown own JSON data instead of treating known node labels as a schema guarantee", () => {
  fc.assert(fc.property(fc.jsonValue({ maxDepth: 3 }), fc.jsonValue({ maxDepth: 3 }), (beforeData, afterData) => {
    const before = withRoot({ ...root("Kept"), data: beforeData }), after = withRoot({ ...root("Kept"), data: afterData });
    expect(comparePlainTidyAst(before.root, after.root)).toBeUndefined();
    expect(guarded(before, after)).toBe(reference(before, after));
  }), { seed: 2026112103, numRuns: 300 });
});

it.each([
  ["Words\n", "Changed\n"], ["- Words\n", "Words\n"], ["\uFEFFWords\r\n", "Words\r\n"],
  ["---\ntitle: Kept\n---\nWords\n", "---\ntitle: Changed\n---\nWords\n"],
  ["---\na: &key One\nb: *key\na: &key Two\n---\nWords\n", "---\na: &key Two\nb: *key\na: &key One\n---\nWords\n"],
  ["[[Folder/My  note]]\n", "[[Folder/My note]]\n"], ["![[File|an  alias]]\n", "![[File|an alias]]\n"],
  ["Text $x  + y$.\n", "Text $x + y$.\n"], ["$$\r\nx  + y\r\n$$\r\n", "$$\r\nx + y\r\n$$\r\n"],
  ["`a  b`\n", "`a b`\n"], ["```\na  b\n```\n", "```\na b\n```\n"],
  ["[Words](https://one.test)\n", "[Words](https://two.test)\n"], ["- [ ] Words\n", "- [x] Words\n"],
  ["<div>literal  words</div>\n", "<div>literal words</div>\n"],
])("rejects a changed word or literal boundary exactly like the original proof (%j)", (before, after) => {
  const original = parseTidyDocument(before!), next = parseTidyDocument(after!);
  expect(reference(original, next)).toBe(false);
  expect(createTidyContentGuard(original)(next)).toBe(false);
});

it("preserves unknown __proto__ fields without prototype assignment", () => {
  const before = root("Kept"), after = root("Kept");
  Object.defineProperty(before, "__proto__", { value: { words: "One" }, enumerable: true });
  Object.defineProperty(after, "__proto__", { value: { words: "Two" }, enumerable: true });
  expect(comparePlainTidyAst(before, after)).toBeUndefined();
  expect(guarded(withRoot(before), withRoot(after))).toBe(false);
  expect(Reflect.get({}, "words")).toBeUndefined();
});

it("rejects unsupported unknown values through the original proof", () => {
  for (const data of [1n, Symbol("literal"), () => "Words", [undefined]]) {
    const document = withRoot({ ...root("Kept"), data });
    expect(comparePlainTidyAst(document.root, document.root)).toBeUndefined();
    expect(reference(document, document)).toBe(false);
    expect(guarded(document, document)).toBe(false);
  }
});

it("falls back for nonenumerable or inherited required fields", () => {
  for (const inherited of [false, true]) {
    const before = root("Kept"), after = root("Kept");
    if (inherited) { Reflect.deleteProperty(before, "type"); Object.setPrototypeOf(before, { type: "root" }); }
    else Object.defineProperty(before, "type", { value: "root", enumerable: false });
    expect(comparePlainTidyAst(before, after)).toBeUndefined();
    expect(guarded(withRoot(before), withRoot(after))).toBe(reference(withRoot(before), withRoot(after)));
  }
});

it("retains the original sparse/custom-array and nonfinite-field semantics through fallback", () => {
  class CustomChildren extends Array<unknown> {}
  const boundChildren: unknown[] = [paragraph("Kept")];
  Object.defineProperty(boundChildren, "map", { value: boundChildren.map.bind(boundChildren), enumerable: true });
  const pairs: [unknown, unknown][] = [
    [{ type: "root", children: new Array<unknown>(1) }, { type: "root", children: [null] }],
    [{ type: "root", children: new CustomChildren(paragraph("Kept")) }, root("Kept")],
    [{ type: "root", children: boundChildren }, root("Kept")],
    [{ type: "list", ordered: false, start: NaN, children: [] }, { type: "list", ordered: false, start: null, children: [] }],
    [{ type: "text", value: null }, { type: "text", value: NaN }],
    [{ ...root("Kept"), extra: undefined }, root("Kept")],
  ];
  for (const [before, after] of pairs) {
    expect(comparePlainTidyAst(before, after)).toBeUndefined();
    expect(guarded(withRoot(before), withRoot(after))).toBe(reference(withRoot(before), withRoot(after)));
  }
});

it("keeps ignored positions/spread and text whitespace equivalent without ignoring other fields", () => {
  const item = (value: string, spread: boolean) => ({ type: "listItem", checked: null, spread, children: [paragraph(value)] });
  const before = { type: "list", ordered: false, start: null, spread: true, children: [item("one  two", true)], position: { arbitrary: "before" } };
  const after = { type: "list", ordered: false, start: null, spread: false, children: [item("one two", false)], position: null };
  expect(comparePlainTidyAst(before, after)).toBe(true);
  expect(reference(withRoot(before), withRoot(after))).toBe(true);
  expect(guarded(withRoot(before), withRoot(after))).toBe(true);
});
