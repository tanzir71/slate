import { expect, it } from "vitest";
import {
  analyzeSnippetTemplate,
  parseSnippetTemplate,
  renderSnippetTemplate,
} from "../src/snippetTemplate";

const render = (source: string, context = {}) =>
  renderSnippetTemplate(parseSnippetTemplate(source), context);
const values = (source: string) => {
  const result = render(source);
  return result.fields.map((field) => [
    field.index,
    result.text.slice(field.from, field.to),
  ]);
};

it("renders numbered, bare and nested tab stops with a final cursor and UTF-16 ranges", () => {
  const result = render("🙂 ${1:hello ${2:world}} then ${3:bye}$0");
  expect(result.text).toBe("🙂 hello world then bye");
  expect(values("🙂 ${1:hello ${2:world}} then ${3:bye}$0")).toEqual([
    [2, "world"],
    [1, "hello world"],
    [3, "bye"],
    [0, ""],
  ]);
  const outer = result.fields.find((field) => field.index === 1)!;
  expect(outer.from).toBe(3);
  expect(result.fields.find((field) => field.index === 2)!.parents).toContain(
    outer.order,
  );
  expect(render("$1 $2").fields.at(-1)?.from).toBe(1);
});
it("resolves forward references and clones nested defaults for linked occurrences", () => {
  const result = render("$1 / ${1:hello ${2:world}} / $1");
  expect(result.text).toBe("hello world / hello world / hello world");
  expect(result.fields.filter((field) => field.index === 1)).toHaveLength(3);
  expect(result.fields.filter((field) => field.index === 2)).toHaveLength(3);
  expect(new Set(result.fields.map((field) => field.order)).size).toBe(
    result.fields.length,
  );
  expect(render("${1:a} ${1:a}").text).toBe("a a");
});
it("keeps literal braces, named dollar expressions, Markdown escapes and escaped tab stops", () => {
  const result = render(
    '\\${1:literal} ${2:{"value": 1}} \\\\ \\* ${name} \\{{date}}',
  );
  expect(result.text).toBe('${1:literal} {"value": 1} \\ \\* ${name} {{date}}');
  expect(result.fields.filter((field) => field.index !== 0)).toHaveLength(1);
  expect(result.issues).toEqual([]);
});
it("expands template variables once; braces and tab stops supplied as values are literal data", () => {
  const result = render(
    "${1:{{title|upper}}} / {{clipboard}} / {{selection}} / {{date}} / {{time}} / {{space}} / {{notebook}} / {{id}}",
    {
      title: "A {title}",
      clipboard: "${9:clipboard} {{date}}",
      selection: "#{not a field}",
      space: "Work",
      notebook: "Notes",
      id: "ID",
      clock: { date: "2026-11-19", time: "09:30" },
    },
  );
  expect(result.text).toBe(
    "A {TITLE} / ${9:clipboard} {{date}} / #{not a field} / 2026-11-19 / 09:30 / Work / Notes / ID",
  );
  expect(result.fields.map((field) => field.index)).toEqual([1, 0]);
  expect(result.issues).toEqual([]);
});
it("shares prompt defaults, honors empty answers and preserves unknown/missing variables with original source positions", () => {
  const source =
    "${1:{{prompt:Owner|Sam}}} {{prompt:Owner|Else}} {{unknown}} {{clipboard}}";
  const template = parseSnippetTemplate(source);
  expect(analyzeSnippetTemplate(template).prompts).toEqual([
    { label: "Owner", defaultValue: "Sam" },
  ]);
  expect(renderSnippetTemplate(template, { prompts: { Owner: "" } }).text).toBe(
    "  {{unknown}} {{clipboard}}",
  );
  const result = renderSnippetTemplate(template, {});
  expect(result.text).toBe("Sam Sam {{unknown}} {{clipboard}}");
  expect(
    result.issues.map((issue) => [
      issue.kind,
      source.slice(issue.from, issue.to),
    ]),
  ).toEqual([
    ["unknown-variable", "{{unknown}}"],
    ["missing-value", "{{clipboard}}"],
  ]);
});
it("treats cursor variables and explicit zero stops as final positions without adding fields from values", () => {
  const result = render("before {{cursor}} middle $0 after", {
    selection: "{{cursor}}",
  });
  expect(result.text).toBe("before  middle  after");
  expect(result.fields).toHaveLength(1);
  expect(result.fields[0]!.from).toBe(7);
  expect(render("${0:done}").fields[0]).toMatchObject({
    index: 0,
    from: 0,
    to: 4,
  });
  expect(
    render("{{selection}}", { selection: "{{cursor}}" }).fields[0]!.from,
  ).toBe(10);
});
it("supports multiline defaults and normalizes CRLF/CR values before assigning editor ranges", () => {
  const result = render("${1:one\r\ntwo\r${2:three}}\n{{clipboard}}$0", {
    clipboard: "four\r\nfive",
  });
  expect(result.text).toBe("one\ntwo\nthree\nfour\nfive");
  expect(result.fields.find((field) => field.index === 2)).toMatchObject({
    from: 8,
    to: 13,
  });
  expect(result.fields.at(-1)?.from).toBe(result.text.length);
});
it.each([
  "${1",
  "${1x}",
  "${1:missing",
  "${1:${1}}",
  "${1:$2} ${2:$1}",
  "${1:a} ${1:b}",
  "$1000",
])("refuses malformed or cyclic tab stops %j before insertion", (source) => {
  expect(() => parseSnippetTemplate(source)).toThrow();
});
it("reports malformed template variables without interpreting their contents as fields", () => {
  const result = render("{{unknown ${1:not a field}}}");
  expect(result.text).toBe("{{unknown ${1:not a field}}}");
  expect(result.fields.map((field) => field.index)).toEqual([0]);
  expect(result.issues).toHaveLength(1);
});
it("bounds parser depth and output amplification while preserving the original source", () => {
  expect(() => parseSnippetTemplate("x".repeat(1_048_577))).toThrow(
    "at most 1 MiB",
  );
  expect(() => parseSnippetTemplate("${1}".repeat(1025))).toThrow(
    "too many tab stops",
  );
  expect(() =>
    parseSnippetTemplate(
      Array.from({ length: 34 }, (_, i) => "${" + (i + 1) + ":").join("") +
        "text" +
        "}".repeat(34),
    ),
  ).toThrow("nested too deeply");
  const source =
    "${1:$2$2} ${2:$3$3} ${3:$4$4} ${4:$5$5} ${5:$6$6} ${6:$7$7} ${7:$8$8} ${8:$9$9} ${9:$10$10} ${10:x}";
  const template = parseSnippetTemplate(source);
  expect(() => renderSnippetTemplate(template, {})).toThrow(
    "too many tab-stop occurrences",
  );
  expect(() =>
    render("{{clipboard}}", { clipboard: "x".repeat(1_048_577) }),
  ).toThrow("at most 1 MiB");
  expect(() => render("{{cursor}}".repeat(1025))).toThrow(
    "too many tab-stop occurrences",
  );
  expect(source).toContain("${1:$2$2}");
});
