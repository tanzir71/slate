import { parse as parseYaml } from "yaml";
import { expect, it } from "vitest";
import {
  analyzeMarkdownTemplate,
  readMarkdownTemplate,
  renderMarkdownTemplate,
} from "../src/markdownTemplate";

const source = [
  "---",
  "template:",
  "  name: Meeting notes",
  "  description: Agenda, decisions and actions",
  "  category: Work",
  '  destination: "product/meetings"',
  '  filename: "{{date:YYYY-MM-DD}}-{{title|slug}}"',
  'title: "{{title}}"',
  'date: "{{date}}"',
  "tags: [meeting]",
  "---",
  "## Agenda",
  "- {{cursor}}",
  "## Decisions",
].join("\n");
const context = {
  title: 'API "Review"\nstatus: injected',
  clock: { date: "2026-11-18", time: "09:15" },
  notebook: "Inbox",
};
function properties(content: string) {
  return parseYaml(
    content
      .replace(/^\uFEFF?---\r?\n/, "")
      .split(/\r?\n(?:---|\.\.\.)(?:\r?\n|$)/)[0]!,
    { logLevel: "silent" },
  ) as Record<string, unknown>;
}
it("reads the handover format, strips only template configuration and renders a safe sheet", () => {
  const template = readMarkdownTemplate(source, "Fallback");
  expect(template).toEqual({
    source,
    name: "Meeting notes",
    description: "Agenda, decisions and actions",
    category: "Work",
    destination: "product/meetings",
    filename: "{{date:YYYY-MM-DD}}-{{title|slug}}",
  });
  const output = renderMarkdownTemplate(template, context);
  expect(properties(output.content)).toEqual({
    title: context.title,
    date: "2026-11-18",
    tags: ["meeting"],
  });
  expect(output.destination).toBe("product/meetings");
  expect(output.filename).toBe("2026-11-18-api-review-status-injected");
  expect(output.content.slice(output.cursor!)).toBe("\n## Decisions");
  expect(output.content).toContain("## Agenda\n- \n## Decisions");
  expect(output.issues).toEqual([]);
  expect(template.source).toBe(source);
});
it("keeps body metadata-looking words, nested properties and YAML comments", () => {
  const template = readMarkdownTemplate(
    "---\n# Keep this comment\ntemplate: { name: Example }\nother:\n  template: literal\n# Keep this too\ncount: 3\n---\n\ntemplate: **body words**\n",
    "Fallback",
  );
  const result = renderMarkdownTemplate(template, {});
  expect(result.content).toContain("# Keep this too");
  expect(properties(result.content)).toEqual({
    other: { template: "literal" },
    count: 3,
  });
  expect(result.content).toContain("\n\ntemplate: **body words**\n");
});
it("preserves BOM, CRLF, closing ellipsis, scalar types and exact body bytes", () => {
  const source =
    "\uFEFF---\r\ntemplate: { name: CRLF }\r\nflag: true\r\ncount: 2\r\nnothing: null\r\ntitle: '{{title}}'\r\n...\r\n\r\nWords  \r\n🙂 {{cursor}}Tail\r\n";
  const output = renderMarkdownTemplate(
    readMarkdownTemplate(source, "Fallback"),
    { title: "O'Brien" },
  );
  expect(output.content.startsWith("\uFEFF---\r\n")).toBe(true);
  expect(output.content).toContain("\r\n...\r\n\r\nWords  \r\n🙂 Tail\r\n");
  expect(properties(output.content)).toEqual({
    flag: true,
    count: 2,
    nothing: null,
    title: "O'Brien",
  });
  expect(output.content.slice(output.cursor!)).toBe("Tail\r\n");
});
it("renders plain Markdown without adding metadata and uses caller defaults", () => {
  const template = readMarkdownTemplate(
    "# {{title}}\n\n{{cursor}}Keep.",
    "Plain",
  );
  expect(template.name).toBe("Plain");
  expect(template.category).toBe("Other");
  const result = renderMarkdownTemplate(template, {
    title: "New",
    notebook: "Work",
  });
  expect(result).toEqual({
    content: "# New\n\nKeep.",
    cursor: 7,
    destination: "Work",
    filename: "New",
    issues: [],
  });
});
it("removes an otherwise-empty template header and keeps body separators", () => {
  expect(
    renderMarkdownTemplate(
      readMarkdownTemplate(
        "---\ntemplate: { name: Plain }\n---\n\nKeep.\n",
        "Fallback",
      ),
      {},
    ).content,
  ).toBe("\nKeep.\n");
});

it("retains comment-only metadata instead of discarding its words or cursor", () => {
  const template = readMarkdownTemplate(
    "---\ntemplate: { name: Comments }\n# {{cursor}}Keep these words.\n---\nBody",
    "Fallback",
  );
  const result = renderMarkdownTemplate(template, {});
  expect(result.content).toContain("Keep these words.");
  expect(result.content.slice(result.cursor!, result.cursor! + 4)).toBe("Keep");
  expect(properties(result.content)).toEqual({});
});
it("keeps unknown variables verbatim and reports their actual field", () => {
  const template = readMarkdownTemplate(
    '---\ntemplate:\n  filename: "{{futureName}}"\ntitle: "{{futureTitle}}"\n---\n{{futureBody}}',
    "Unknown",
  );
  const output = renderMarkdownTemplate(template, {});
  expect(properties(output.content)).toEqual({ title: "{{futureTitle}}" });
  expect(output.content.endsWith("{{futureBody}}")).toBe(true);
  expect(output.filename).toBe("{{futureName}}");
  expect(output.issues.map((issue) => issue.scope)).toEqual([
    "frontmatter.title",
    "body",
    "filename",
  ]);
});
it("places a metadata cursor after YAML escaping and gives the first marker precedence", () => {
  const template = readMarkdownTemplate(
    '---\ntitle: "{{title}}{{cursor}} End"\n---\nBody {{cursor}}kept.',
    "Cursor",
  );
  const output = renderMarkdownTemplate(template, { title: 'A "quote"' });
  expect(output.content.includes("\uE000")).toBe(false);
  expect(output.content.slice(output.cursor!, output.cursor! + 4)).toBe(" End");
  expect(output.content.endsWith("Body kept.")).toBe(true);
});
it("avoids cursor-marker collisions with source and supplied values", () => {
  const title = "\uE000slate-cursor0\uE001";
  const result = renderMarkdownTemplate(
    readMarkdownTemplate(
      '---\ntitle: "{{title}}{{cursor}}"\n---\nKept.',
      "Marker",
    ),
    { title },
  );
  expect(properties(result.content).title).toBe(title);
  expect(result.content.slice(0, result.cursor)).toContain(title);
});
it("collects prompts and clipboard needs from decoded properties, body and routing fields", () => {
  const template = readMarkdownTemplate(
    '---\ntemplate:\n  filename: "{{prompt:Project|Notes}}"\n  destination: "{{prompt:Folder|Work}}"\ntitle: "{{prompt:Project|Other}}"\n---\n{{clipboard}} {{prompt:Owner}}',
    "Prompts",
  );
  const analysis = analyzeMarkdownTemplate(template);
  expect(analysis.variables).toContain("clipboard");
  expect(analysis.prompts.map((prompt) => prompt.label)).toEqual([
    "Project",
    "Owner",
    "Folder",
  ]);
  const result = renderMarkdownTemplate(template, {
    clipboard: "Kept",
    prompts: { Project: "Plan", Owner: "Sam", Folder: "Work" },
  });
  expect(result.filename).toBe("Plan");
  expect(result.destination).toBe("Work");
  expect(properties(result.content).title).toBe("Plan");
  expect(result.content.endsWith("Kept Sam")).toBe(true);
});

it("never consumes supplied text that becomes the caret marker after filtering", () => {
  const title = "\uE000SLATE-CURSOR0\uE001 USER WORDS";
  const result = renderMarkdownTemplate(
    readMarkdownTemplate(
      '---\ntitle: "{{title|lower}}{{cursor}}"\n---\nKept.',
      "Marker",
    ),
    { title },
  );
  expect(properties(result.content).title).toBe(title.toLowerCase());
  expect(result.content.slice(0, result.cursor)).toContain(title.toLowerCase());
  expect(result.content.match(/\uE000/g)).toHaveLength(1);
});

it("renders metadata comments as comments and locates the first printed cursor", () => {
  const source =
    '---\n# {{date}} {{cursor}}Keep this\nvalue: "{{title}}" # {{prompt:Owner|Sam}}\n---\nBody {{cursor}}kept.';
  const result = renderMarkdownTemplate(
    readMarkdownTemplate(source, "Comments"),
    { ...context, prompts: { Owner: "A\ninjected: false" } },
  );
  expect(properties(result.content)).toEqual({ value: context.title });
  expect(result.content).toContain("# 2026-11-18 Keep this");
  expect(result.content).toMatch(/# ?injected: false/);
  expect(result.content.slice(result.cursor!, result.cursor! + 9)).toBe(
    "Keep this",
  );
  expect(result.content.endsWith("Body kept.")).toBe(true);
});

it("shares prompt defaults across all content and routing fields", () => {
  const source =
    '---\ntemplate:\n  filename: "{{prompt:Project|Different}}"\ntitle: "{{prompt:Project|First}}"\n---\n{{prompt:Project|Other}}';
  const result = renderMarkdownTemplate(
    readMarkdownTemplate(source, "Defaults"),
    {},
  );
  expect(properties(result.content).title).toBe("First");
  expect(result.content.endsWith("First")).toBe(true);
  expect(result.filename).toBe("First");
});

it.each([
  '---\n"tem{{cursor}}plate": reserved\n---\nBody',
  '---\n"a{{cursor}}": one\na: two\n---\nBody',
])(
  "rejects reserved or duplicate property keys after removing a cursor: %j",
  (source) => {
    expect(() =>
      renderMarkdownTemplate(readMarkdownTemplate(source, "Keys"), {}),
    ).toThrow();
  },
);
it("promotes anchors referenced from stripped configuration without losing metadata", () => {
  const template = readMarkdownTemplate(
    "---\ntemplate:\n  name: &name 'Shared {{title}}'\n  defaults: &defaults { tag: work }\ntitle: *name\nother: *defaults\nagain: *name\n---\nBody",
    "Aliases",
  );
  const output = renderMarkdownTemplate(template, { title: "Notes" });
  expect(properties(output.content)).toEqual({
    title: "Shared Notes",
    other: { tag: "work" },
    again: "Shared Notes",
  });
  expect(output.issues).toEqual([]);
});
it("keeps normal shared/cyclic YAML anchors and does not execute custom tags", () => {
  const template = readMarkdownTemplate(
    "---\na: &a { self: *a, title: '{{title}}' }\nb: *a\ncode: !!js/function 'not executed'\n---\nBody",
    "Aliases",
  );
  const output = renderMarkdownTemplate(template, { title: "Kept" });
  const data = properties(output.content);
  expect(data.b).toBe(data.a);
  expect((data.a as Record<string, unknown>).self).toBe(data.a);
  expect((data.a as Record<string, unknown>).title).toBe("Kept");
  expect(data.code).toBe("not executed");
});
it.each([
  "---\ntemplate:\n  name: Missing close",
  "---\n- not a mapping\n---\nBody",
  "---\ntemplate: true\n---\nBody",
  "---\ntemplate: { name: [not, a, string] }\n---\nBody",
  "---\ntemplate: {}\ntemplate: {}\n---\nBody",
  "---\ninvalid: *missing\n---\nBody",
])("rejects malformed metadata before producing a sheet: %j", (source) => {
  expect(() => readMarkdownTemplate(source, "Invalid")).toThrow();
});
