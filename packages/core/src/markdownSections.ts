import { markdownHeadings, type MarkdownHeading } from "./markdownHeadings.js";
import { markdownBodyFrom } from "./markdownBody.js";
import { markdownBoundary } from "./markdownBoundary.js";
import type { MarkdownBlockMove } from "./blockMovement.js";

export interface MarkdownSection {
  readonly heading: MarkdownHeading;
  /** Whole physical heading line through the last payload character. */
  readonly from: number;
  readonly to: number;
  /** Start of the next section at this depth or above, including separator space. */
  readonly end: number;
}
export interface MarkdownSectionDocument {
  readonly source: string;
  readonly bodyFrom: number;
  readonly sections: readonly MarkdownSection[];
}
function contentEnd(source: string, from: number, end: number): number {
  while (end > from && (source[end - 1] === "\r" || source[end - 1] === "\n")) end--;
  return end;
}

/** Resolve section moves at an explicit interaction, never on the typing path. */
export function scanMarkdownSections(source: string): MarkdownSectionDocument {
  const bodyFrom = markdownBodyFrom(source);
  const headings = markdownHeadings(source).filter(heading => heading.root);
  const starts = headings.map(heading => Math.max(bodyFrom,
    Math.max(source.lastIndexOf("\n", heading.from - 1), source.lastIndexOf("\r", heading.from - 1)) + 1));
  const sections = headings.map((heading, index): MarkdownSection => {
    let next = index + 1;
    while (next < headings.length && headings[next]!.depth > heading.depth) next++;
    const from = starts[index]!, end = starts[next] ?? source.length;
    return { heading, from, to: contentEnd(source, heading.to, end), end };
  });
  return { source, bodyFrom, sections };
}

/** Move a complete section before a heading index, or sections.length for EOF.
 * Keep payloads and metadata verbatim; use the existing block separator policy.
 * A parent cannot move into its own descendants. Apply only to this exact source.
 */
export function planMarkdownSectionMove(
  document: MarkdownSectionDocument,
  index: number,
  before: number,
): MarkdownBlockMove | undefined {
  const { source, sections, bodyFrom } = document;
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(before) || index < 0 || index >= sections.length || before < 0 || before > sections.length)
    throw new RangeError("Invalid section move.");
  const section = sections[index]!;
  const destination = sections[before]?.from ?? contentEnd(source, bodyFrom, source.length);
  if (destination >= section.from && destination <= section.end) return;

  // Keep the original EOF whitespace in place when removing the last section.
  const from = section.end === source.length ? contentEnd(source, bodyFrom, section.from) : section.from;
  const to = section.end === source.length ? section.to : section.end;
  const remaining = source.slice(0, from) + source.slice(to);
  const position = destination >= to ? destination - (to - from) : destination;
  const prefix = remaining.slice(0, position), suffix = remaining.slice(position);
  const payload = source.slice(section.from, section.to), eol = source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const leading = prefix.trim() ? markdownBoundary(prefix, payload, eol) : "";
  const trailing = suffix.trim() ? markdownBoundary(payload, suffix, eol) : "";
  return {
    changes: [{ from, to, text: "" }, { from: destination, to: destination, text: leading + payload + trailing }].sort((left, right) => left.from - right.from),
    selection: { anchor: position + leading.length, head: position + leading.length + payload.length },
  };
}
