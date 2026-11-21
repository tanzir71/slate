import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { classHighlighter, tags } from "@lezer/highlight";
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
import { createSmartTableBindings } from "./smartTables.js";
import { createSmartPaste, type SmartPasteOptions } from "./smartPaste.js";
import { createFenceInput, type FenceInputOptions } from "./fenceInput.js";
import { historyIsolation } from "./historyIsolation.js";
import { lazyCodeLanguage } from "./codeLanguages.js";
export { createFenceInput, enterEditorFence, chooseEditorFenceLanguage, type EditorFenceRequest, type FenceInputOptions } from "./fenceInput.js";
export { requestEditorSnippet, insertEditorSnippet, moveEditorSnippetField, clearEditorSnippet, editorSnippetFields, type EditorSnippetRequest } from "./snippetInsertion.js";
export { createSnippetTriggers, type SnippetTriggerOptions } from "./snippetTriggers.js";
export { createSmartPaste, type SmartPasteOptions, type PasteNotice } from "./smartPaste.js";
export type { ClipboardImageReference, SaveClipboardImage } from "./clipboardImages.js";
export { createSmartTableBindings, navigateTableCell, enterEditorTable, formatEditorTable, editorTableColumns, runTableCommand } from "./smartTables.js";
import { createSelectionPairs } from "./selectionPairs.js";
export { createSelectionPairs, planSelectionPair } from "./selectionPairs.js";
export { createDocumentSession, type DocumentSession, type DocumentSessionSnapshot, type DocumentSessionUpdate } from "./documentSession.js";
export { applyDocumentSourceChanges } from "./documentSourceChanges.js";
export { editorHistoryDelegate, type EditorHistoryDelegate, type EditorHistoryReplacement } from "./documentHistory.js";
export { tidyEditorHistory, editorTidyLines, editorSource, editorSourceEffect, editorSourceEffects, editorSourceStateEffect, applyEditorTidy } from "./tidy.js";
export { markdownCompletionQuery, type MarkdownCompletionQuery } from "./completionQuery.js";
export { createMarkdownCompletions, type MarkdownCompletionOptions } from "./markdownCompletions.js";
export { requestEditorDate, insertEditorDate, type EditorDateRequest } from "./dateInsertion.js";
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
export { requestEditorCustomBlock, insertEditorCustomBlock, type EditorCustomBlockRequest } from "./customBlockInsertion.js";
export { editorBlockTarget, currentEditorBlock, moveEditorBlock, insertEditorBlockAt, type EditorBlockTarget } from "./editorBlocks.js";
export { editorSectionTarget } from "./editorSections.js";
export { createWritingModeExtensions, typewriterScrollTop, type WritingFocus } from "./writingMode.js";

export { convertClipboardHtml } from "./clipboardHtml.js";

export interface EditorHud {
  words: number;
  characters: number;
  readingTimeMinutes: number;
}

export function createSlateMarkdownExtensions(
  options: {
    history?: boolean;
    formattingKeys?: boolean;
    hideSyntax?: boolean;
    highContrastMarkers?: boolean;
    smartLists?: false | SmartListOptions;
    selectionPairs?: boolean;
    smartTables?: boolean;
    smartPaste?: false | SmartPasteOptions;
    fenceInput?: false | FenceInputOptions;
  } = {},
): Extension[] {
  return [
    options.history === false ? [] : history(),
    historyIsolation,
    markdown({ extensions: slateMarkdownSyntax, codeLanguages: lazyCodeLanguage, addKeymap: false, pasteURLAsLink: false }),
    search(),
    livePreviewSettings.of({
      hideSyntax: options.hideSyntax !== false,
      highContrastMarkers: options.highContrastMarkers === true,
    }),
    createLivePreviewExtension(),
    highlightActiveLine(),
    syntaxHighlighting(classHighlighter),
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
    createSmartTableBindings(options.smartTables !== false),
    options.smartLists === false ? [] : createSmartListBindings(options.smartLists),
    createSelectionPairs(options.selectionPairs !== false),
    options.smartPaste === false ? [] : createSmartPaste(options.smartPaste),
    options.fenceInput === false ? [] : createFenceInput(options.fenceInput),
    keymap.of([...defaultKeymap, ...(options.history === false ? [] : historyKeymap)]),
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
