import { readMarkdownTemplate, type MarkdownTemplate } from "@slate/core";
import source0 from "./builtins/meeting-notes.md?raw";
import source1 from "./builtins/one-on-one.md?raw";
import source2 from "./builtins/status-update.md?raw";
import source3 from "./builtins/prd.md?raw";
import source4 from "./builtins/decision-record.md?raw";
import source5 from "./builtins/blog-post.md?raw";
import source6 from "./builtins/newsletter-issue.md?raw";
import source7 from "./builtins/readme.md?raw";
import source8 from "./builtins/bug-report.md?raw";
import source9 from "./builtins/daily-note.md?raw";
import source10 from "./builtins/weekly-review.md?raw";
import source11 from "./builtins/reading-notes.md?raw";

export interface TemplateCatalogItem {
  readonly id: string;
  readonly origin: "built-in" | "space";
  readonly path?: string;
  readonly template: MarkdownTemplate;
}

/** These Markdown files are the source of truth for the bundled global library. */
export const builtinTemplates: readonly TemplateCatalogItem[] = [
  {
    id: "builtin:meeting-notes",
    origin: "built-in",
    template: readMarkdownTemplate(source0, "Meeting notes"),
  },
  {
    id: "builtin:one-on-one",
    origin: "built-in",
    template: readMarkdownTemplate(source1, "1:1"),
  },
  {
    id: "builtin:status-update",
    origin: "built-in",
    template: readMarkdownTemplate(source2, "Status update"),
  },
  {
    id: "builtin:prd",
    origin: "built-in",
    template: readMarkdownTemplate(source3, "PRD"),
  },
  {
    id: "builtin:decision-record",
    origin: "built-in",
    template: readMarkdownTemplate(source4, "Decision record"),
  },
  {
    id: "builtin:blog-post",
    origin: "built-in",
    template: readMarkdownTemplate(source5, "Blog post"),
  },
  {
    id: "builtin:newsletter-issue",
    origin: "built-in",
    template: readMarkdownTemplate(source6, "Newsletter issue"),
  },
  {
    id: "builtin:readme",
    origin: "built-in",
    template: readMarkdownTemplate(source7, "README"),
  },
  {
    id: "builtin:bug-report",
    origin: "built-in",
    template: readMarkdownTemplate(source8, "Bug report"),
  },
  {
    id: "builtin:daily-note",
    origin: "built-in",
    template: readMarkdownTemplate(source9, "Daily note"),
  },
  {
    id: "builtin:weekly-review",
    origin: "built-in",
    template: readMarkdownTemplate(source10, "Weekly review"),
  },
  {
    id: "builtin:reading-notes",
    origin: "built-in",
    template: readMarkdownTemplate(source11, "Reading notes"),
  },
];
