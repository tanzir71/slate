import {
  renderMarkdownTemplate,
  type MarkdownTemplate,
} from "./markdownTemplate.js";
import type { TemplateContext } from "./templateVariables.js";

import { templateOutputPath } from "./templatePath.js";
export { templateOutputPath } from "./templatePath.js";

export function planTemplateFile(
  template: MarkdownTemplate,
  context: TemplateContext,
  overrides: { readonly destination?: string; readonly filename?: string } = {},
) {
  const rendered = renderMarkdownTemplate(template, context);
  const issues = rendered.issues.filter(
    (entry) =>
      !(entry.scope === "destination" && overrides.destination !== undefined) &&
      !(entry.scope === "filename" && overrides.filename !== undefined),
  );
  const unresolved = issues.find(
    (entry) => entry.scope === "destination" || entry.scope === "filename",
  );
  if (unresolved)
    throw new Error(
      "Resolve the template " +
        unresolved.scope +
        " variables before creating a sheet.",
    );
  const destination = overrides.destination ?? rendered.destination,
    filename = overrides.filename ?? rendered.filename;
  return {
    ...rendered,
    destination,
    filename,
    issues,
    path: templateOutputPath(destination, filename),
  };
}
