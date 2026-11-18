import { expect, it } from "vitest";
import {
  analyzeMarkdownTemplate,
  parseSheet,
  planTemplateFile,
} from "@slate/core";
import { builtinTemplates } from "../src/templates/builtinTemplates";

const names = [
  "Meeting notes",
  "1:1",
  "Status update",
  "PRD",
  "Decision record",
  "Blog post",
  "Newsletter issue",
  "README",
  "Bug report",
  "Daily note",
  "Weekly review",
  "Reading notes",
];
const context = {
  title: "Design review / launch 🙂",
  id: "01KA7NFJ800000000000000000",
  space: "Work",
  notebook: "Inbox",
  clock: { date: "2026-11-18", time: "13:05:09", offsetMinutes: 360 },
  selection: "",
  clipboard: "",
};
it("contains exactly the twelve v0.5 built-ins in the handover's categories", () => {
  expect(builtinTemplates.map((item) => item.template.name)).toEqual(names);
  expect(new Set(builtinTemplates.map((item) => item.id)).size).toBe(12);
  expect(
    builtinTemplates.filter((item) => item.template.category === "Work"),
  ).toHaveLength(5);
  expect(
    builtinTemplates.filter((item) => item.template.category === "Writing"),
  ).toHaveLength(2);
  expect(
    builtinTemplates.filter((item) => item.template.category === "Engineering"),
  ).toHaveLength(2);
  expect(
    builtinTemplates.filter((item) => item.template.category === "Personal"),
  ).toHaveLength(3);
});
it.each(builtinTemplates)(
  "renders $id to an ordinary Markdown note with a destination and body caret",
  ({ template }) => {
    const prompts = Object.fromEntries(
      analyzeMarkdownTemplate(template).prompts.map((prompt) => [
        prompt.label,
        prompt.defaultValue ?? "Example",
      ]),
    );
    const plan = planTemplateFile(template, { ...context, prompts });
    expect(plan.issues).toEqual([]);
    expect(plan.path).toMatch(/\.md$/);
    expect(plan.path.startsWith(".slate/")).toBe(false);
    expect(plan.content).not.toContain("{{");
    expect(plan.cursor).toBeGreaterThan(plan.content.indexOf("\n---\n") + 5);
    expect(plan.cursor).toBeLessThanOrEqual(plan.content.length);
    const sheet = parseSheet(plan.content, plan.path);
    expect(sheet.frontmatter.template).toBeUndefined();
    expect(sheet.frontmatter.date).toBe("2026-11-18");
    expect(sheet.frontmatter.title).toBe(
      template.name === "Daily note" ? "2026-11-18" : context.title,
    );
    expect(sheet.body.trim()).not.toBe("");
  },
);
it("uses calendar-stable daily/weekly names and a conventional README", () => {
  const path = (id: string) =>
    planTemplateFile(
      builtinTemplates.find((item) => item.id === "builtin:" + id)!.template,
      context,
    ).path;
  expect(path("daily-note")).toBe("Daily/2026-11-18.md");
  expect(path("weekly-review")).toBe("Reviews/2026-W47-weekly-review.md");
  expect(path("readme")).toBe("Inbox/README.md");
});
