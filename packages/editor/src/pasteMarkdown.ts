import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState, SelectionRange } from "@codemirror/state";
import {
  insideEditorFrontmatter,
  markdownInputAllowed,
} from "./markdownInputContext.js";

export const markdownDestination = (value: string) =>
  value.replace(/[\\()<>&]/g, "\\$&");

export function imagePasteMarkdown(
  image: { path: string; alt?: string },
  fallback = "Image",
): string {
  const alt = (image.alt ?? fallback)
    .replace(/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g, "\\$&")
    .replace(/\r\n?|\n/g, " ");
  return "![" + alt + "](" + markdownDestination(image.path) + ")";
}

export function clipboardUrl(value: string): string | undefined {
  const trimmed = value.trim();
  const text = /^www\./i.test(trimmed) ? "https://" + trimmed : trimmed;
  if (!text || /\s|\p{Cc}/u.test(text)) return;
  try {
    if (["http:", "https:", "mailto:", "xmpp:"].includes(new URL(text).protocol))
      return text;
  } catch {
    /* Ordinary clipboard text is not a URL. */
  }
}

export function linkedSelection(
  state: EditorState,
  range: SelectionRange,
  url: string,
): string | undefined {
  if (range.empty) return;
  const source = state.sliceDoc(range.from, range.to);
  if (/\n[ \t]*\n/.test(source)) return;
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  if (!tree) return;
  const key = (label: string) =>
    label
      .replace(/\\([\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e])/g, "$1")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
  const references = new Set<string>();
  tree.iterate({
    enter(node) {
      if (node.name !== "LinkReference") return;
      const label = node.node.getChild("LinkLabel");
      if (label)
        references.add(key(state.sliceDoc(label.from + 1, label.to - 1)));
    },
  });
  const code: { from: number; to: number }[] = [];
  const skipped: { from: number; to: number }[] = [];
  const autolinks: { from: number; to: number }[] = [];
  let block = false;
  tree.iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      if (
        /^(CodeBlock|FencedCode|HTMLBlock|HorizontalRule|ATXHeading\d|SetextHeading\d)$/.test(
          node.name,
        )
      )
        block = true;
      if (node.name === "InlineCode") {
        code.push({ from: node.from, to: node.to });
        return false;
      }
      if (
        node.name === "Autolink" &&
        node.from >= range.from &&
        node.to <= range.to
      ) {
        skipped.push(
          { from: node.from, to: node.from + 1 },
          { from: node.to - 1, to: node.to },
        );
        autolinks.push({ from: node.from + 1, to: node.to - 1 });
      }
      if (node.name !== "Link" && node.name !== "Image") return;
      const marks = node.node.getChildren("LinkMark");
      if (marks.length < 2) return;
      const label = node.node.getChild("LinkLabel");
      const reference = label
        ? state.sliceDoc(label.from + 1, label.to - 1)
        : "";
      const resolved =
        node.node.getChild("URL") ||
        references.has(
          key(reference || state.sliceDoc(marks[0]!.to, marks[1]!.from)),
        );
      if (!resolved) return;
      if (node.name === "Image") {
        code.push({ from: node.from, to: node.to });
        return false;
      }
      // A link cannot contain another link. Keep its label and replace its target.
      skipped.push(
        { from: node.from, to: marks[0]!.to },
        { from: marks[1]!.from, to: node.to },
      );
    },
  });
  if (block) return;
  skipped.sort((left, right) => left.from - right.from);
  let skip = 0;
  let label = "",
    backslashes = 0,
    region = 0;
  for (let offset = 0; offset < source.length; offset++) {
    const position = range.from + offset;
    while (skipped[skip] && skipped[skip]!.to <= position) skip++;
    if (skipped[skip] && skipped[skip]!.from <= position) continue;
    while (code[region] && code[region]!.to <= position) region++;
    const literalCode = code[region] && code[region]!.from <= position;
    const character = source[offset]!;
    if (autolinks.some((item) => item.from <= position && position < item.to)) {
      if (/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(character))
        label += "\\";
      label += character;
      backslashes = 0;
      continue;
    }
    if (
      !literalCode &&
      (character === "[" || character === "]") &&
      backslashes % 2 === 0
    )
      label += "\\";
    label += character;
    backslashes = character === "\\" ? backslashes + 1 : 0;
  }
  return "[" + label + "](" + markdownDestination(url) + ")";
}

export function pasteInputAllowed(
  state: EditorState,
  range: SelectionRange,
): boolean {
  if (!range.empty) {
    if (
      insideEditorFrontmatter(state, range.from) ||
      insideEditorFrontmatter(state, range.to)
    )
      return false;
    const tree = ensureSyntaxTree(state, range.to, 1000);
    if (!tree) return false;
    for (const [position, bias] of [
      [range.from, 1],
      [range.to, -1],
    ] as const) {
      for (
        let node = tree.resolveInner(position, bias);
        node;
        node = node.parent!
      ) {
        if (
          /Code|Link|URL|Autolink|HTML|Comment/.test(node.name) &&
          !(node.from >= range.from && node.to <= range.to)
        )
          return false;
      }
    }
    return true;
  }
  if (!markdownInputAllowed(state, range.head)) return false;
  if (range.head === 0) return true;
  const tree = ensureSyntaxTree(state, range.head, 1000);
  for (
    let node = tree?.resolveInner(range.head, -1);
    node;
    node = node.parent ?? undefined
  )
    if (/^(CodeBlock|FencedCode|HTMLBlock|Comment)$/.test(node.name))
      return false;
  return true;
}

export function isBlockPaste(text: string): boolean {
  return (
    text.includes("\n") ||
    /^(?:#{1,6}\s|> |[-+*] |\d+[.)] |\x60{3,}|~{3,}|\|)/.test(text) ||
    /^(?:-{3,}|\*{3,}|_{3,})$/.test(text)
  );
}

/** Keep unselected words and quote/list continuations when inserting blocks. */
export function contextualPaste(
  state: EditorState,
  range: SelectionRange,
  text: string,
): { insert: string; cursor: number } {
  const first = state.doc.lineAt(range.from),
    last = state.doc.lineAt(range.to);
  const before = state.sliceDoc(first.from, range.from);
  const after = state.sliceDoc(range.to, last.to);
  const leading = /^[ \t]*(?:(?:>[ \t]*)|(?:(?:[-+*]|\d+[.)])[ \t]+))*/.exec(
    first.text,
  )![0];
  const prefix =
    range.from >= first.from + leading.length
      ? leading.replace(/[-+*]|\d+[.)]/g, (marker) => " ".repeat(marker.length))
      : "";
  const start =
    before.trim() && before !== leading ? "\n" + prefix + "\n" + prefix : "";
  const end = after.trim() ? "\n" + prefix + "\n" + prefix : "";
  const body = text.split("\n").join("\n" + prefix);
  return { insert: start + body + end, cursor: start.length + body.length };
}
