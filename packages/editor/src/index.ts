import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { search } from "@codemirror/search";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from "@codemirror/view";
import { computeStats } from "@slate/core";

export interface EditorHud {
  words: number;
  characters: number;
  readingTimeMinutes: number;
}

export interface MarkerRange {
  from: number;
  to: number;
  line: number;
  kind: "heading" | "emphasis" | "wiki";
}

export interface WikiLinkHit {
  from: number;
  to: number;
  raw: string;
  target: string;
  display: string;
  targetId: string | undefined;
}

const wikiLinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const ulidLikePattern = /^(?:id:)?01[0-9A-HJKMNP-TV-Z]{24}$/i;

export function createSlateMarkdownExtensions(): Extension[] {
  return [
    history(),
    markdown(),
    search(),
    createInvisibleMarkdownExtension(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": {
        fontFamily: "var(--font-editor)",
        fontSize: "18px",
        lineHeight: "1.7"
      },
      ".cm-content": {
        caretColor: "var(--slate-accent)"
      },
      ".cm-focused": {
        outline: "none"
      },
      ".cm-line": {
        padding: "0 2px"
      }
    })
  ];
}

export function createInvisibleMarkdownExtension(): Extension {
  return [
    invisibleMarkdownPlugin,
    EditorView.theme({
      ".cm-slate-hidden-marker": {
        opacity: "0.22"
      },
      ".cm-focused .cm-slate-hidden-marker": {
        transition: "opacity 120ms ease-out"
      }
    })
  ];
}

export function findWikiLinkAtPosition(markdownText: string, position: number): WikiLinkHit | undefined {
  for (const match of markdownText.matchAll(wikiLinkPattern)) {
    const raw = match[0];
    const from = match.index;
    const to = from + raw.length;
    if (position < from || position >= to) {
      continue;
    }

    const rawTarget = (match[1] ?? "").trim();
    const display = (match[2] ?? rawTarget).trim();
    const targetId = normalizeTargetId(rawTarget);

    return {
      from,
      to,
      raw,
      target: targetId ?? rawTarget,
      display,
      targetId
    };
  }

  return undefined;
}

export function computeEditorHud(markdownText: string): EditorHud {
  const stats = computeStats(markdownText);
  return {
    words: stats.words,
    characters: computeVisibleCharacters(markdownText),
    readingTimeMinutes: stats.readingTimeMinutes
  };
}

export function findInactiveMarkdownMarkerRanges(markdownText: string, activeLine: number): MarkerRange[] {
  const ranges: MarkerRange[] = [];
  let offset = 0;
  const lines = markdownText.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] ?? "";

    if (lineNumber !== activeLine) {
      collectHeadingMarkers(line, offset, lineNumber, ranges);
      collectEmphasisMarkers(line, offset, lineNumber, ranges);
      collectWikiMarkers(line, offset, lineNumber, ranges);
    }

    offset += line.length + 1;
  }

  return ranges.sort((left, right) => left.from - right.from);
}

function collectHeadingMarkers(
  line: string,
  offset: number,
  lineNumber: number,
  ranges: MarkerRange[]
): void {
  const match = line.match(/^(#{1,6})\s/);
  if (!match?.[1]) {
    return;
  }

  ranges.push({ from: offset, to: offset + match[1].length, line: lineNumber, kind: "heading" });
}

function collectEmphasisMarkers(
  line: string,
  offset: number,
  lineNumber: number,
  ranges: MarkerRange[]
): void {
  for (const match of line.matchAll(/\*\*|__/g)) {
    ranges.push({
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      line: lineNumber,
      kind: "emphasis"
    });
  }
}

function collectWikiMarkers(line: string, offset: number, lineNumber: number, ranges: MarkerRange[]): void {
  for (const match of line.matchAll(/\[\[[^\]]+\]\]/g)) {
    const start = offset + match.index;
    const text = match[0];
    ranges.push({ from: start, to: start + 2, line: lineNumber, kind: "wiki" });

    const pipe = text.indexOf("|");
    if (pipe >= 0) {
      ranges.push({ from: start + pipe, to: start + pipe + 1, line: lineNumber, kind: "wiki" });
    }

    ranges.push({ from: start + text.length - 2, to: start + text.length, line: lineNumber, kind: "wiki" });
  }
}

const invisibleMarkdownPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildInvisibleMarkdownDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildInvisibleMarkdownDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations
  }
);

function buildInvisibleMarkdownDecorations(view: EditorView): DecorationSet {
  const markdownText = view.state.doc.toString();
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const builder = new RangeSetBuilder<Decoration>();

  for (const range of findInactiveMarkdownMarkerRanges(markdownText, activeLine)) {
    builder.add(
      range.from,
      range.to,
      Decoration.mark({
        class: `cm-slate-hidden-marker cm-slate-marker-${range.kind}`
      })
    );
  }

  return builder.finish();
}

function computeVisibleCharacters(markdownText: string): number {
  const visible = markdownText
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match: string, target: string, display: string | undefined) => {
      return display ?? target;
    })
    .replace(/(^|[\s([>])#([A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*)/g, "$1$2")
    .replace(/[*_`~=\-[\]()!?.:,;]/g, "");

  return visible.replace(/\s/g, "").length;
}

function normalizeTargetId(target: string): string | undefined {
  if (!ulidLikePattern.test(target)) {
    return undefined;
  }

  return target.replace(/^id:/i, "").toUpperCase();
}
