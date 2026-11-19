import type { BlockContext, BlockPlan } from "./blocks.js";
import { markdownBoundary } from "./markdownBoundary.js";

export interface CustomBlock {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly group: "Blocks";
  readonly placement: "block";
  readonly source: string;
}
const directory = ".slate/blocks/";
const maximumBytes = 1_048_576;

/** Count UTF-8 without platform APIs, stopping before an oversized fragment is copied. */
function checkSize(source: string) {
  let bytes = 0;
  if (source.length <= maximumBytes) {
    for (let index = 0; index < source.length; index++) {
      const point = source.codePointAt(index)!;
      bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
      if (point > 0xffff) index++;
      if (bytes > maximumBytes) break;
    }
    if (bytes <= maximumBytes) return;
  }
  throw new Error("A custom block can contain at most 1 MiB of UTF-8 text.");
}

/** F-32 files are literal Markdown fragments; variables and YAML remain source text. */
export function readCustomBlock(source: string, path: string): CustomBlock {
  const relative = path.slice(directory.length);
  if (
    !path.startsWith(directory) ||
    !/\.md$/i.test(relative) ||
    /[\\:]/.test(relative) ||
    [...relative].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Choose a Markdown file inside .slate/blocks/.");
  const stem = relative.replace(/\.md$/i, ""),
    label = stem.split("/").at(-1)!;
  if (!label.trim())
    throw new Error("Choose a named Markdown file inside .slate/blocks/.");
  checkSize(source);
  return {
    id: "custom:" + path,
    path,
    label,
    description: relative,
    aliases: [...new Set([stem, label])],
    group: "Blocks",
    placement: "block",
    source,
  };
}

export interface MarkdownFragment {
  readonly source: string;
  /** A prepared template may choose a UTF-16 caret; literal files default to their end. */
  readonly cursor?: number;
}

/** Replace only the requested span; adapters enforce syntax, ownership and stale-source guards. */
export function planCustomBlock(
  block: MarkdownFragment,
  context: Pick<BlockContext, "source" | "from" | "to">,
): Extract<BlockPlan, { kind: "insert" }> {
  const { source, from, to } = context;
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to < from ||
    to > source.length
  )
    throw new RangeError("Invalid custom block insertion range.");
  checkSize(block.source);
  const offset = block.cursor ?? block.source.length;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > block.source.length
  )
    throw new RangeError("Invalid fragment cursor.");
  const eol = source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const text = block.source.replace(/^\uFEFF/, "").replace(/\r\n?|\n/g, eol);
  const prefix = source.slice(0, from);
  const before = markdownBoundary(prefix === "\uFEFF" ? "" : prefix, text, eol);
  const after = markdownBoundary(text, source.slice(to), eol);
  const cursorText = block.source
    .slice(0, offset)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?|\n/g, eol);
  const cursor = from + before.length + cursorText.length;
  return {
    kind: "insert",
    changes: [{ from, to, text: before + text + after }],
    selection: { anchor: cursor, head: cursor },
  };
}
