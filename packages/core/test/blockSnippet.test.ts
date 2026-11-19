import { expect, it } from "vitest";
import {
  parseSnippetTemplate,
  prepareBlockSnippet,
  renderSnippetTemplate,
} from "../src/index";
const expand = (source: string) =>
  renderSnippetTemplate(parseSnippetTemplate(source), {});
it("surrounds a gutter snippet with blank lines while retaining a literal body BOM and correct UTF-16 fields", () => {
  const original = expand("\uFEFF${1:one\r\ntwo}${2:🙂}$0");
  const prepared = prepareBlockSnippet(
    original,
    { source: "BeforeAfter", from: 6, to: 6 },
    true,
  );
  expect(prepared.text).toBe("\n\n\uFEFFone\ntwo🙂\n\n");
  expect(
    prepared.fields.map(({ index, from, to }) => [index, from, to]),
  ).toEqual([
    [1, 3, 10],
    [2, 10, 12],
    [0, 12, 12],
  ]);
  expect(original.text).toBe("\uFEFFone\ntwo🙂");
  expect(original.fields[0]?.from).toBe(1);
});
it("keeps normalized linked and nested fields without altering parent relationships or adding inline separation", () => {
  const original = expand("${1:outer ${2:one\r\ntwo}} / ${2}$0");
  const prepared = prepareBlockSnippet(
    original,
    { source: "Before /snippet", from: 7, to: 15 },
    false,
  );
  expect(prepared.text).toBe("outer one\ntwo / one\ntwo");
  expect(
    prepared.fields
      .filter((field) => field.index === 2)
      .map((field) => prepared.text.slice(field.from, field.to)),
  ).toEqual(["one\ntwo", "one\ntwo"]);
  expect(prepared.fields.map((field) => field.parents)).toEqual(
    original.fields.map((field) => field.parents),
  );
});
it("keeps the note's file BOM directly before the first content", () => {
  expect(
    prepareBlockSnippet(
      expand("Text$0"),
      { source: "\uFEFF", from: 1, to: 1 },
      true,
    ).text,
  ).toBe("Text");
});
it("rejects invalid spans and field offsets before any edit", () => {
  expect(() =>
    prepareBlockSnippet(expand("Text"), { source: "", from: -1, to: 0 }, true),
  ).toThrow("range");
  const original = expand("${1:Text}");
  expect(() =>
    prepareBlockSnippet(
      { ...original, fields: [{ ...original.fields[0]!, from: 2, to: 1 }] },
      { source: "", from: 0, to: 0 },
      false,
    ),
  ).toThrow("field range");
  expect(() =>
    prepareBlockSnippet(
      { ...original, fields: [{ ...original.fields[0]!, to: 50 }] },
      { source: "", from: 0, to: 0 },
      false,
    ),
  ).toThrow("field offset");
});
