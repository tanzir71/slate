import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { search } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap } from "@codemirror/view";
import { computeStats } from "@slate/core";
import { createFormattingBindings } from "./formatting.js";
import {
  createLivePreviewExtension,
  livePreviewSettings,
} from "./livePreview.js";
import { slateMarkdownSyntax } from "./markdownSyntax.js";
import { createSmartListBindings, type SmartListOptions } from "./smartLists.js";
import { createSelectionPairs } from "./selectionPairs.js";
export { createSelectionPairs, planSelectionPair } from "./selectionPairs.js";
export { markdownCompletionQuery, type MarkdownCompletionQuery } from "./completionQuery.js";
export { createSmartListBindings, indentEditorListItem, moveEditorListItem, type SmartListOptions } from "./smartLists.js";
export {
  createFormattingBindings,
  formattingCommandIds,
  runFormattingCommand,
  setEditorBlock,
  toggleEditorTask,
  wrapEditorSelection,
} from "./formatting.js";
export {
  buildLivePreviewDecorations,
  createLivePreviewExtension,
  findEditorWikiLink,
  knownWikiTargets,
  knownWikiPaths,
  livePreviewSettings,
} from "./livePreview.js";
export { findWikiLinkAtPosition, type WikiLinkHit } from "./wikiLinks.js";
export { editorBlockQuery, insertEditorBlock, type BlockQuery } from "./blockInsertion.js";

export interface EditorHud {
  words: number;
  characters: number;
  readingTimeMinutes: number;
}

export function createSlateMarkdownExtensions(
  options: {
    formattingKeys?: boolean;
    hideSyntax?: boolean;
    highContrastMarkers?: boolean;
    smartLists?: false | SmartListOptions;
    selectionPairs?: boolean;
  } = {},
): Extension[] {
  return [
    history(),
    markdown({ extensions: slateMarkdownSyntax, addKeymap: false }),
    search(),
    livePreviewSettings.of({
      hideSyntax: options.hideSyntax !== false,
      highContrastMarkers: options.highContrastMarkers === true,
    }),
    createLivePreviewExtension(),
    highlightActiveLine(),
    syntaxHighlighting(
      HighlightStyle.define([
        {
          tag: tags.heading,
          fontWeight: "600",
          color: "inherit",
          textDecoration: "none",
        },
        { tag: tags.strong, fontWeight: "700" },
        { tag: tags.emphasis, fontStyle: "italic" },
        { tag: tags.link, color: "var(--slate-accent)" },
        { tag: tags.monospace, fontFamily: "monospace" },
      ]),
    ),
    options.formattingKeys === false ? [] : createFormattingBindings(),
    options.smartLists === false ? [] : createSmartListBindings(options.smartLists),
    createSelectionPairs(options.selectionPairs !== false),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": {
        fontFamily: "var(--font-editor)",
        fontSize: "18px",
        lineHeight: "1.7",
      },
      ".cm-content": {
        caretColor: "var(--slate-accent)",
      },
      ".cm-scroller": { fontFamily: "var(--font-editor)" },
      ".cm-focused": {
        outline: "none",
      },
      ".cm-line": {
        padding: "0 2px",
      },
    }),
  ];
}

export function computeEditorHud(markdownText: string): EditorHud {
  const stats = computeStats(markdownText);
  return {
    words: stats.words,
    characters: computeVisibleCharacters(markdownText),
    readingTimeMinutes: stats.readingTimeMinutes,
  };
}

function computeVisibleCharacters(markdownText: string): number {
  const visible = markdownText
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match: string, target: string, display: string | undefined) => {
        return display ?? target;
      },
    )
    .replace(
      /(^|[\s([>])#([A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*)/g,
      "$1$2",
    )
    .replace(/[*_`~=\-[\]()!?.:,;]/g, "");

  return visible.replace(/\s/g, "").length;
}
