import { expect, it } from "vitest";
import { planTemplateFile, templateOutputPath } from "../src/templateFile";
import { readMarkdownTemplate } from "../src/markdownTemplate";

it.each([
  ["", "Notes", "Notes.md"],
  ["Work/Meetings", "Review.md", "Work/Meetings/Review.md"],
  ["Work\\Meetings\\", "Review.MD", "Work/Meetings/Review.MD"],
  ["বাংলা", "লেখা 🙂", "বাংলা/লেখা 🙂.md"],
  ["Café", "Résumé", "Café/Résumé.md"],
  ["", ".draft", ".draft.md"],
  ["", "draft.txt", "draft.txt.md"],
])(
  "plans a portable relative Markdown file in %j with %j",
  (directory, name, expected) => {
    expect(templateOutputPath(directory, name)).toBe(expected);
  },
);
it.each([
  ["/Work", "Name"],
  ["C:\\Work", "Name"],
  ["\\\\server\\share", "Name"],
  ["../Work", "Name"],
  ["Work/../Other", "Name"],
  ["Work//Other", "Name"],
  [".slate/templates", "Name"],
  ["Work/.SLATE", "Name"],
  ["Work", "../outside"],
  ["Work", "nested/name"],
  ["Work", "nested\\name"],
  ["Work", ""],
  ["Work", "."],
  ["Work", ".."],
  ["Work", ".md"],
  ["Work", "NUL"],
  ["CON/Folder", "Name"],
  ["Work", "CoM1.txt"],
  ["Work", "LPT²"],
  ["Work", "aux.md"],
  ["Work", "CON .txt"],
  ["Work ", "Name"],
  ["Work.", "Name"],
  ["Work", "Name "],
  ["Work", "Name."],
  ["Work", "name:stream"],
  ["Work", "name*"],
  ["Work", "bad\u0000name"],
  ["Work", "\uD800name"],
  ["Work", "x".repeat(256)],
  ["Work", "🙂".repeat(64)],
])(
  "rejects unsafe/nonportable routing without rewriting it: %j / %j",
  (directory, name) => {
    expect(() => templateOutputPath(directory, name)).toThrow();
  },
);
it("uses rendered routing and offers explicit overrides without changing sheet content", () => {
  const template = readMarkdownTemplate(
    '---\ntemplate:\n  destination: "Work/{{prompt:Project|Slate}}"\n  filename: "{{date}}-{{title|slug}}"\ntitle: "{{title}}"\n---\n{{cursor}}Keep.',
    "Meeting",
  );
  const context = {
    title: "API Review",
    clock: { date: "2026-11-18", time: "09:30" },
  };
  const plan = planTemplateFile(template, context);
  expect(plan.path).toBe("Work/Slate/2026-11-18-api-review.md");
  expect(plan.content.slice(plan.cursor!)).toBe("Keep.");
  const changed = planTemplateFile(template, context, {
    destination: "",
    filename: "Other",
  });
  expect(changed.path).toBe("Other.md");
  expect(changed.content).toBe(plan.content);
});
it("requires unresolved route fields to be supplied and keeps unknown body variables reported", () => {
  const template = readMarkdownTemplate(
    '---\ntemplate:\n  filename: "{{unknown}}"\n---\n{{future}}',
    "Unknown",
  );
  expect(() => planTemplateFile(template, {})).toThrow(/filename/i);
  const plan = planTemplateFile(template, {}, { filename: "Kept" });
  expect(plan.path).toBe("Kept.md");
  expect(plan.content).toBe("{{future}}");
  expect(plan.issues.map((issue) => issue.scope)).toEqual(["body"]);
});
