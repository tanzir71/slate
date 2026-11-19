import { planTemplateFile, starterKitRoot, type TemplateContext } from "@slate/core";
import type { BrowserSheet } from "@slate/storage/browser-space";
import { builtinTemplates } from "./builtinTemplates";

export const starterKits = [
  {
    id: "work",
    name: "Work",
    description: "Keep meetings and project decisions together.",
    notes: [
      {
        notebook: "Meetings",
        title: "Weekly sync",
        template: "builtin:meeting-notes",
      },
      {
        notebook: "Projects",
        title: "Project outline",
        template: "builtin:prd",
      },
    ],
  },
  {
    id: "writing",
    name: "Writing",
    description: "Move from an outline to a draft and a newsletter.",
    notes: [
      {
        notebook: "Drafts",
        title: "First draft",
        template: "builtin:blog-post",
      },
      {
        notebook: "Newsletter",
        title: "Next issue",
        template: "builtin:newsletter-issue",
      },
    ],
  },
  {
    id: "engineering",
    name: "Engineering",
    description: "Start project documentation and track reproducible bugs.",
    notes: [
      {
        notebook: "Projects",
        title: "Project README",
        template: "builtin:readme",
      },
      {
        notebook: "Issues",
        title: "First bug report",
        template: "builtin:bug-report",
      },
    ],
  },
  {
    id: "personal",
    name: "Personal",
    description: "Review your week and keep notes on what you read.",
    notes: [
      {
        notebook: "Reviews",
        title: "Weekly review",
        template: "builtin:weekly-review",
      },
      {
        notebook: "Reading",
        title: "Reading notes",
        template: "builtin:reading-notes",
      },
    ],
  },
] as const;
export type StarterKit = (typeof starterKits)[number];

export function starterKit(id: string): StarterKit {
  const kit = starterKits.find((item) => item.id === id);
  if (!kit) throw new Error("Choose an available starter kit.");
  return kit;
}
export function planStarterKit(
  kit: StarterKit,
  root: string,
  context: TemplateContext,
) {
  starterKitRoot(root, []);
  const notes = kit.notes.map((note) => {
    const template = builtinTemplates.find(
      (item) => item.id === note.template,
    )!.template;
    return planTemplateFile(
      template,
      { ...context, notebook: root + "/" + note.notebook, title: note.title },
      {
        destination: root + "/" + note.notebook,
        filename: note.title,
      },
    );
  });
  return {
    root,
    notes: [
      {
        path: root + "/Overview.md",
        content:
          "# " +
          kit.name +
          "\n\n" +
          kit.description +
          "\n\n## Start here\n\n" +
          kit.notes
            .map(
              (note) =>
                "- **" +
                note.notebook +
                "** — " +
                note.title +
                ". New Sheet uses the " +
                builtinTemplates.find((item) => item.id === note.template)!
                  .template.name +
                " template.",
            )
            .join("\n") +
          "\n\nThese are ordinary Markdown files. Edit, move or export them whenever you like. Notebook defaults can be changed from Sheet actions.\n",
        cursor: 0,
      },
      ...notes,
    ],
    defaults: Object.fromEntries(
      kit.notes.map((note) => [root + "/" + note.notebook, note.template]),
    ),
  };
}
export interface StarterKitInstallation {
  readonly plan: ReturnType<typeof planStarterKit>;
  readonly saved: BrowserSheet[];
  defaultsSaved: boolean;
  complete: boolean;
}
