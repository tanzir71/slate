import { expect, it } from "vitest";
import {
  planCustomBlock,
  prepareInlineTemplate,
  readMarkdownTemplate,
} from "../src/index";
const definition = (source: string) => readMarkdownTemplate(source, "Inline");

it("renders ordinary properties and cursor without evaluating new-file planning fields", () => {
  const template = definition(
    '---\ntemplate:\n  name: Inline\n  destination: "{{prompt:Folder}}"\n  filename: "{{unknown}}"\ntitle: "{{title}}"\n---\nHello {{prompt:Name|friend}} {{cursor}}after',
  );
  const result = prepareInlineTemplate(template, { title: "a: b" });
  expect(result.template).not.toHaveProperty("destination");
  expect(result.template).not.toHaveProperty("filename");
  expect(result.analysis.prompts).toEqual([
    { label: "Name", defaultValue: "friend" },
  ]);
  expect(result.analysis.variables).toContain("title");
  expect(result.rendered!.issues).toEqual([]);
  expect(result.rendered!.content).toContain('title: "a: b"');
  expect(result.rendered!.content).not.toContain("template:");
  expect(result.rendered!.content.slice(result.rendered!.cursor)).toBe("after");
  expect(result.needsInput).toBe(true);
  expect(template.destination).toBe("{{prompt:Folder}}");
});
it("plain inline templates can insert directly; clipboard and unknown variables require review", () => {
  expect(prepareInlineTemplate(definition("> Literal"), {}).needsInput).toBe(
    false,
  );
  expect(
    prepareInlineTemplate(definition("{{clipboard}}"), {
      clipboard: "",
    }).needsInput,
  ).toBe(true);
  expect(prepareInlineTemplate(definition("{{unknown}}"), {}).needsInput).toBe(
    true,
  );
});
it.each([
  ["\uFEFFA\r\n🙂B", 6, "Before\n\n/", "Before\n\nA\n🙂B", 12],
  ["\uFEFFA\nB", 3, "Before\r\n\r\n/", "Before\r\n\r\nA\r\nB", 13],
  ["{{literal}}", 0, "/", "{{literal}}", 0],
] as const)(
  "maps a prepared caret through BOM removal and target line endings",
  (source, cursor, note, expected, caret) => {
    const plan = planCustomBlock(
      { source, cursor },
      { source: note, from: note.length - 1, to: note.length },
    );
    const change = plan.changes[0]!;
    expect(
      note.slice(0, change.from) + change.text + note.slice(change.to),
    ).toBe(expected);
    expect(plan.selection).toEqual({ anchor: caret, head: caret });
  },
);
it.each([-1, 2, 0.5, Infinity])(
  "rejects an invalid prepared caret %s",
  (cursor) => {
    expect(() =>
      planCustomBlock({ source: "a", cursor }, { source: "", from: 0, to: 0 }),
    ).toThrow("fragment cursor");
  },
);

it("keeps editable prompts available when a default would render an invalid reserved property", () => {
  const prepared = prepareInlineTemplate(
    definition('---\n"{{prompt:Key|template}}": value\n---\nBody'),
    {},
  );
  expect(prepared.rendered).toBeUndefined();
  expect(prepared.error).toContain("reserved template key");
  expect(prepared.needsInput).toBe(true);
  expect(prepared.analysis.prompts[0]?.label).toBe("Key");
});
