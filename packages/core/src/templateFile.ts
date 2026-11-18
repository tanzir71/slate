import {
  renderMarkdownTemplate,
  type MarkdownTemplate,
} from "./markdownTemplate.js";
import type { TemplateContext } from "./templateVariables.js";

function utf8Length(value: string): number {
  let length = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    length += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return length;
}
/** Shared portable subset: https://learn.microsoft.com/windows/win32/fileio/naming-a-file */
function portableComponent(name: string): void {
  const controls = [...name].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
  const device =
    /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³]) *(?:\.|$)/i.test(
      name,
    );
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[<>:"/\\|?*]/.test(name) ||
    controls ||
    /[\uD800-\uDFFF]/u.test(name) ||
    /^[ ]|[ .]$/.test(name) ||
    device ||
    utf8Length(name) > 255
  )
    throw new Error("Use a portable file or folder name: " + name);
}
/** Proposes a path only. The storage adapter must still create a collision-safe new file. */
export function templateOutputPath(
  destination: string,
  filename: string,
): string {
  const directory = destination.replaceAll("\\", "/");
  if (directory.startsWith("/"))
    throw new Error("Template destinations must stay inside this Space.");
  const parents = directory.replace(/\/+$/, "");
  const parts = parents ? parents.split("/") : [];
  for (const part of parts) {
    portableComponent(part);
    if (part.toLowerCase() === ".slate")
      throw new Error("A new sheet cannot replace Slate configuration.");
  }
  portableComponent(filename);
  if (filename.toLowerCase() === ".md")
    throw new Error("The filename needs a name before .md.");
  const name = /\.md$/i.test(filename) ? filename : filename + ".md";
  portableComponent(name);
  return [...parts, name].join("/");
}
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
