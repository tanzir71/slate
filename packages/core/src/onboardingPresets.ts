import { readMarkdownTemplate } from "./markdownTemplate.js";
import { readCustomBlock } from "./customBlocks.js";
import { readSnippetConfiguration } from "./snippets.js";

export const onboardingPresets = [
  { id: "writer", name: "Writer" },
  { id: "developer", name: "Developer" },
  { id: "researcher", name: "Researcher" },
  { id: "student", name: "Student" },
  { id: "minimal", name: "Minimal" },
] as const;
export type OnboardingPresetId = (typeof onboardingPresets)[number]["id"];
interface PresetContent {
  templates: readonly { name: string; body: string }[];
  block: { name: string; body: string };
  snippets: readonly { trigger: string; name: string; body: string }[];
}
const contents: Record<Exclude<OnboardingPresetId, "minimal">, PresetContent> = {
  writer: {
    templates: [
      { name: "Draft", body: "## Idea\n{{cursor}}\n\n## Outline\n- \n\n## Draft\n\n## Review\n- [ ] Read aloud\n- [ ] Check facts and sources\n" },
      { name: "Story outline", body: "## Premise\n{{cursor}}\n\n## Characters\n\n## Setting\n\n## Beginning\n\n## Middle\n\n## Ending\n" },
    ],
    block: { name: "Writing review", body: "## Review\n- [ ] Make the opening clear\n- [ ] Check names and sources\n- [ ] Read aloud\n" },
    snippets: [{ trigger: ";draft", name: "Draft heading", body: "## ${1:Section}\n${2:First draft}\n$0" }, { trigger: ";quote", name: "Attributed quotation", body: "> ${1:Quotation}\n>\n> — ${2:Source}\n$0" }],
  },
  developer: {
    templates: [
      { name: "Technical design", body: "## Problem\n{{cursor}}\n\n## Constraints\n\n## Proposed design\n\n## Alternatives\n\n## Validation\n- [ ] Tests\n- [ ] Rollback plan\n" },
      { name: "Bug investigation", body: "## Observed behavior\n{{cursor}}\n\n## Expected behavior\n\n## Reproduction\n1. \n\n## Evidence\n\n## Fix and verification\n" },
    ],
    block: { name: "Change checklist", body: "## Change checklist\n- [ ] Cover the behavior with a test\n- [ ] Preserve existing data\n- [ ] Verify the change\n- [ ] Document recovery\n" },
    snippets: [{ trigger: ";code", name: "Code fence", body: "```${1:typescript}\n${2:code}\n```\n$0" }, { trigger: ";decision", name: "Design decision", body: "### ${1:Decision}\nContext: ${2:Why}\nDecision: ${3:Choice}\n$0" }],
  },
  researcher: {
    templates: [
      { name: "Source notes", body: "## Citation\n{{cursor}}\n\n## Question\n\n## Evidence\n\n## Limitations\n\n## Connections\n" },
      { name: "Research log", body: "## Research question\n{{cursor}}\n\n## Method\n\n## Observations\n\n## Interpretation\n\n## Next steps\n" },
    ],
    block: { name: "Evidence record", body: "## Evidence\n- Claim: \n- Source: \n- Observation: \n- Limitations: \n" },
    snippets: [{ trigger: ";source", name: "Source reference", body: "[${1:Source title}](${2:https://example.com})$0" }, { trigger: ";finding", name: "Research finding", body: "**Finding:** ${1:Observation}\n**Evidence:** ${2:Source}\n**Limitations:** ${3:Uncertainty}\n$0" }],
  },
  student: {
    templates: [
      { name: "Lecture notes", body: "## Topic\n{{cursor}}\n\n## Key ideas\n\n## Examples\n\n## Questions\n\n## Summary\n" },
      { name: "Revision plan", body: "## Learning goal\n{{cursor}}\n\n## Topics\n- [ ] \n\n## Practice questions\n\n## Recall\n\n## Next review\n" },
    ],
    block: { name: "Recall questions", body: "## Recall\n- What is the main idea?\n- Can I explain it in my own words?\n- What example demonstrates it?\n- What do I still need to review?\n" },
    snippets: [{ trigger: ";question", name: "Study question", body: "**Question:** ${1:Prompt}\n**Answer:** ${2:Recall from memory}\n$0" }, { trigger: ";study", name: "Study task", body: "- [ ] Review ${1:topic} — ${2:date}\n$0" }],
  },
};

/** Produce ordinary local library files; no preference, clock or platform state is read. */
export function onboardingPresetFiles(id: string): Readonly<Record<string, string>> {
  const preset = onboardingPresets.find(preset => preset.id === id);
  if (!preset) throw Error("Choose an available starter kit.");
  if (preset.id === "minimal") return {};
  const content = contents[preset.id], files: Record<string, string> = {};
  for (const item of content.templates) {
    const path = `.slate/templates/${preset.name} - ${item.name}.md`;
    const source = `---\ntemplate:\n  name: ${JSON.stringify(item.name)}\n  description: ${JSON.stringify(preset.name + " starter kit")}\n  category: ${JSON.stringify(preset.name)}\ntitle: "{{title}}"\ndate: "{{date}}"\n---\n# {{title}}\n\n${item.body}`;
    readMarkdownTemplate(source, item.name); files[path] = source;
  }
  const path = `.slate/blocks/${content.block.name}.md`;
  readCustomBlock(content.block.body, path); files[path] = content.block.body;
  const snippets = { version: 1, snippets: content.snippets };
  readSnippetConfiguration(snippets); files[".slate/snippets.json"] = JSON.stringify(snippets, null, 2) + "\n";
  return files;
}
