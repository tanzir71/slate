import type { BlockContext } from "./blocks.js";
import { markdownBoundary } from "./markdownBoundary.js";
import type { renderSnippetTemplate } from "./snippetTemplate.js";

type Expansion = ReturnType<typeof renderSnippetTemplate>;

/** Add optional gutter separation to the renderer's LF text and shift every field together. */
export function prepareBlockSnippet(
  expansion: Expansion,
  context: Pick<BlockContext, "source" | "from" | "to">,
  separate: boolean,
): Expansion {
  const { source, from, to } = context;
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to < from ||
    to > source.length
  )
    throw new RangeError("Invalid snippet insertion range.");
  const text = expansion.text,
    prefix = source.slice(0, from);
  const before = separate
    ? markdownBoundary(prefix === "\uFEFF" ? "" : prefix, text, "\n")
    : "";
  const after = separate ? markdownBoundary(text, source.slice(to), "\n") : "";
  return {
    ...expansion,
    text: before + text + after,
    fields: expansion.fields.map((field) => {
      if (field.to < field.from)
        throw new RangeError("Invalid snippet field range.");
      if (
        !Number.isSafeInteger(field.from) ||
        !Number.isSafeInteger(field.to) ||
        field.from < 0 ||
        field.to > text.length
      )
        throw new RangeError("Invalid snippet field offset.");
      return {
        ...field,
        from: before.length + field.from,
        to: before.length + field.to,
      };
    }),
  };
}
