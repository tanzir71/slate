import {
  analyzeSnippetTemplate,
  parseSheet,
  parseSnippetTemplate,
  renderSnippetTemplate,
  type ScopedSnippet,
} from "@slate/core";
import { captureTemplateContext } from "../templates/templateSession";
import type { SnippetTarget } from "./snippetTypes";

export function createSnippetInvocation(
  target: SnippetTarget,
  space: string,
  path: string,
) {
  const notebook = path.includes("/")
    ? path.slice(0, path.lastIndexOf("/"))
    : "";
  return {
    target,
    context: {
      ...captureTemplateContext(space, notebook, target.selection),
      title: parseSheet(target.source, path).title,
    },
  };
}
export type SnippetInvocation = ReturnType<typeof createSnippetInvocation>;
export function prepareSnippet(
  invocation: SnippetInvocation,
  definition: ScopedSnippet,
) {
  const template = parseSnippetTemplate(definition.body),
    analysis = analyzeSnippetTemplate(template);
  const rendered = renderSnippetTemplate(template, invocation.context);
  return {
    ...invocation,
    definition,
    template,
    analysis,
    rendered,
    needsInput:
      analysis.prompts.length > 0 ||
      analysis.variables.includes("clipboard") ||
      rendered.issues.length > 0,
  };
}
export type PreparedSnippet = ReturnType<typeof prepareSnippet>;
