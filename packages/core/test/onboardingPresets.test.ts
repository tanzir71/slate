import { expect, it } from "vitest";
import { onboardingPresetFiles, onboardingPresets } from "../src/onboardingPresets";
import { readMarkdownTemplate } from "../src/markdownTemplate";
import { readCustomBlock } from "../src/customBlocks";
import { readSnippetConfiguration } from "../src/snippets";

it("provides the five named onboarding choices and makes Minimal add no local libraries", () => {
  expect(onboardingPresets.map(preset => preset.name)).toEqual(["Writer", "Developer", "Researcher", "Student", "Minimal"]);
  expect(onboardingPresetFiles("minimal")).toEqual({}); expect(() => onboardingPresetFiles("unknown")).toThrow("available starter kit");
});
it.each(["writer", "developer", "researcher", "student"])("%s installs valid reusable templates, literal blocks and distinct snippet triggers", id => {
  const files = onboardingPresetFiles(id), templates = Object.entries(files).filter(([path]) => path.startsWith(".slate/templates/"));
  expect(templates).toHaveLength(2);
  for (const [, source] of templates) {
    const template = readMarkdownTemplate(source, "Fallback");
    expect(template.name).not.toBe("Fallback"); expect(source).toContain("{{cursor}}"); expect(template.category.toLowerCase()).toBe(id);
  }
  const blocks = Object.entries(files).filter(([path]) => path.startsWith(".slate/blocks/")); expect(blocks).toHaveLength(1);
  expect(readCustomBlock(blocks[0]![1], blocks[0]![0]).source.length).toBeGreaterThan(20);
  const snippets = readSnippetConfiguration(JSON.parse(files[".slate/snippets.json"]!)); expect(snippets.snippets).toHaveLength(2);
  expect(new Set(snippets.snippets.map(snippet => snippet.trigger)).size).toBe(2);
});
