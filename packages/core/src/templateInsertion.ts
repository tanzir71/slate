import {
  analyzeMarkdownTemplate,
  renderMarkdownTemplate,
  type MarkdownTemplate,
} from "./markdownTemplate.js";
import type { TemplateContext } from "./templateVariables.js";

/** Inline choices retain ordinary note properties, without planning a new file or destination. */
export function prepareInlineTemplate(
  template: MarkdownTemplate,
  context: TemplateContext,
) {
  const inline: MarkdownTemplate = {
    source: template.source,
    name: template.name,
    description: template.description,
    category: template.category,
  };
  const analysis = analyzeMarkdownTemplate(inline);
  let rendered: ReturnType<typeof renderMarkdownTemplate> | undefined,
    error = "";
  try {
    rendered = renderMarkdownTemplate(inline, context);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return {
    template: inline,
    context,
    analysis,
    rendered,
    error,
    needsInput:
      analysis.prompts.length > 0 ||
      analysis.variables.includes("title") ||
      analysis.variables.includes("clipboard") ||
      !!rendered?.issues.length ||
      !!error,
  };
}
