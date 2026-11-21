import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import {
  createSlateMarkdownExtensions,
  createFormattingBindings,
  runFormattingCommand,
  findEditorWikiLink,
  knownWikiTargets as wikiTargets,
  knownWikiPaths,
  createSmartListBindings,
  createSmartTableBindings,
  editorTableColumns,
  runTableCommand,
  createSelectionPairs,
  createMarkdownCompletions,
  createSnippetTriggers,
  editorSnippetFields,
  requestEditorSnippet,
  insertEditorSnippet,
  tidyEditorHistory,
  editorSource,
  editorSourceEffect,
  editorSourceEffects,
  editorSectionTarget,
  editorTidyLines,
  applyEditorTidy,
  livePreviewSettings,
  createWritingModeExtensions,
  type WritingFocus,
  type SmartListOptions,
  type SaveClipboardImage,
  imagePreviewLoader,
  type LoadPreviewImage,
  type WikiLinkHit
} from "@slate/editor";
import type { DocumentSession } from "@slate/editor";
import { createEditorDocumentBinding } from "./editorDocumentBinding";
import { prepareBlockSnippet, createWikiPathIndex, type ResolvedKeymap, type TextChange, type WikiCompletionTarget, type SnippetIndex, type ScopedSnippet } from "@slate/core";
import type { SnippetTarget } from "./snippets/snippetTypes";
import type { EditorChangeOrigin, EditorCreationTarget, EditorCursor, MarkdownEditorHandle } from "./commands";
import { observeEditorSelection, type ToolbarRect } from "./selectionGeometry";
import { SelectionToolbar } from "./SelectionToolbar";
import type { BlockLibrary } from "./blocks/blockLibrary";
import type { TemplateLibrary } from "./blocks/templateLibrary";
import type { SnippetLibrary } from "./snippets/snippetLibrary";
import { useBlockMenu, type BlockMenuNote, type BlockInsertionContext } from "./useBlockMenu";
import { useBlockGutter } from "./useBlockGutter";
import { useDatePicker } from "./useDatePicker";
import { useSmartPaste } from "./useSmartPaste";
import { useFenceInput } from "./useFenceInput";
import type { ImportBlockImage } from "./BlockResourcePicker";

const externalValue = Annotation.define<boolean>();

function sourceViewExtensions(enabled: boolean) {
  return enabled ? [lineNumbers(), livePreviewSettings.of({ sourceMode: true, hideSyntax: false, highContrastMarkers: false }),
    EditorView.theme({ "&": { fontFamily: "var(--font-mono)", fontSize: "14px", lineHeight: "26px" },
      ".cm-scroller": { fontFamily: "var(--font-mono)" }, ".cm-line span": { fontStyle: "normal", fontWeight: "400" } })] : [];
}

function wikiExtensions(targets?: ReadonlySet<string>, sheets: readonly WikiCompletionTarget[] = []) {
  return [
    wikiTargets.of(new Set([...targets ?? [], ...sheets.flatMap((sheet) => [sheet.title.toLowerCase(), ...(/^01[0-9A-HJKMNP-TV-Z]{24}$/i.test(sheet.id) ? [sheet.id.toLowerCase()] : [])])])),
    knownWikiPaths.of(createWikiPathIndex(sheets)),
  ];
}

function documentChange(previous: string, next: string) {
  let from = 0;
  while (from < previous.length && from < next.length && previous[from] === next[from]) from++;
  let to = previous.length;
  let end = next.length;
  while (to > from && end > from && previous[to - 1] === next[end - 1]) { to--; end--; }
  return { from, to, insert: next.slice(from, end) };
}

interface MarkdownEditorCommonProps {
  writingFocus?: WritingFocus;
  typewriter?: boolean;
  zen?: boolean;
  sourceMode?: boolean;
  tidyLines?: readonly number[];
  onNavigateWikiLink?: (link: WikiLinkHit) => void;
  readOnly?: boolean;
  documentKey?: string;
  viewKey?: string;
  onDocumentError?: (error: unknown) => void;
  onReady?: () => void;
  initialCursor?: number | undefined;
  keymap?: ResolvedKeymap;
  onHandle?: (handle: MarkdownEditorHandle | undefined) => void;
  knownWikiTargets?: ReadonlySet<string>;
  completionSheets?: readonly WikiCompletionTarget[];
  completionTags?: readonly string[];
  wikiCompletion?: boolean;
  tagCompletion?: boolean;
  dateCompletion?: boolean;
  onCursorChange?: (cursor: EditorCursor) => void;
  onImportImage?: ImportBlockImage;
  onLoadImage?: LoadPreviewImage;
  smartLists?: SmartListOptions;
  selectionPairs?: boolean;
  smartTables?: boolean;
  pasteRichText?: boolean;
  pasteLinks?: boolean;
  pasteImages?: boolean;
  pasteTables?: boolean;
  onImportClipboardImage?: SaveClipboardImage;
  fences?: boolean;
  frontmatter?: boolean;
  snippetIndex?: SnippetIndex | undefined;
  customBlockLibrary?: BlockLibrary | undefined;
  templateMenuLibrary?: TemplateLibrary | undefined;
  snippetMenuLibrary?: SnippetLibrary | undefined;
  blockNote?: BlockMenuNote | undefined;
  canInsertBlock?: (() => boolean) | undefined;
  onManageBlocks?: (() => void) | undefined;
  onSnippet?: ((definition: ScopedSnippet, target: SnippetTarget, context?: BlockInsertionContext) => boolean) | undefined;
}
type MarkdownEditorProps = MarkdownEditorCommonProps & (
  | { documentSession: DocumentSession; value?: never; onChange?: never }
  | { documentSession?: undefined; value: string; onChange: (value: string, changes: readonly TextChange[], origin: EditorChangeOrigin) => void }
);

export const MarkdownEditor = memo(function MarkdownEditor({ value, onChange, documentSession, viewKey, onDocumentError, onNavigateWikiLink, readOnly = false, documentKey, onReady, initialCursor, keymap, onHandle, knownWikiTargets, completionSheets, completionTags, wikiCompletion = true, tagCompletion = true, dateCompletion = true, onCursorChange, onImportImage, onLoadImage, smartLists, selectionPairs = true, smartTables = true, pasteRichText = true, pasteLinks = true, pasteImages = true, pasteTables = true, onImportClipboardImage, fences = true, frontmatter = true, snippetIndex, onSnippet, customBlockLibrary, onManageBlocks, templateMenuLibrary, snippetMenuLibrary, blockNote, canInsertBlock, sourceMode = false, tidyLines, writingFocus = "none", typewriter = false, zen = false }: MarkdownEditorProps) {
  const blocks = useBlockMenu(onImportImage, customBlockLibrary, onManageBlocks, {
    templates: templateMenuLibrary, snippets: snippetMenuLibrary, note: blockNote, canInsert: canInsertBlock,
    onSnippet(view, request, definition, separate, context, onInserted) {
      const target = snippetTarget(view, request, separate);
      if (!target) return false;
      const tracked: SnippetTarget = { ...target, insert(expansion) { const accepted = target.insert(expansion); if (accepted) onInserted(); return accepted; } };
      return onSnippetRef.current?.(definition, tracked, context) ?? false;
    },
  });
  const gutter = useBlockGutter(({ view, target, rect }) => blocks.openAt(view, target, rect));
  const currentBlocks = useRef(blocks);
  const creationAllowed = useRef(canInsertBlock);
  const currentDocument = useRef(documentKey);
  useLayoutEffect(() => { currentBlocks.current = blocks; creationAllowed.current = canInsertBlock; currentDocument.current = documentKey; }, [blocks, canInsertBlock, documentKey]);
  const dates = useDatePicker(dateCompletion);
  const fenceInput = useFenceInput(fences, frontmatter);
  const paste = useSmartPaste({ richText: pasteRichText, links: pasteLinks, images: pasteImages, tables: pasteTables, importImage: onImportClipboardImage });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onDocumentErrorRef = useRef(onDocumentError);
  const onNavigateWikiLinkRef = useRef(onNavigateWikiLink);
  const onReadyRef = useRef(onReady);
  const editable = useRef(new Compartment());
  const imageReader = useRef(new Compartment());
  const tidyView = useRef(new Compartment());
  const writingModes = useRef(new Compartment());
  const formattingKeys = useRef(new Compartment());
  const smartListKeys = useRef(new Compartment());
  const tableKeys = useRef(new Compartment());
  const pairs = useRef(new Compartment());
  const pasteRules = useRef(new Compartment());
  const fenceRules = useRef(new Compartment());
  const completions = useRef(new Compartment());
  const snippetRules = useRef(new Compartment());
  const onSnippetRef = useRef(onSnippet);
  const onHandleRef = useRef(onHandle);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [selectionRect, setSelectionRect] = useState<ToolbarRect>();
  const [dismissedSelection, setDismissedSelection] = useState<ToolbarRect>();
  const selectionGeometry = useRef<ToolbarRect | undefined>(undefined);
  const wikiLinks = useRef(new Compartment());
  const previousWikiTargets = useRef(knownWikiTargets);
  const previousCompletionSheets = useRef(completionSheets);
  const onCursorRef = useRef(onCursorChange);
  const lastEmittedValue = useRef<string | undefined>(undefined);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useLayoutEffect(() => { onDocumentErrorRef.current = onDocumentError; }, [onDocumentError]);

  useEffect(() => {
    onNavigateWikiLinkRef.current = onNavigateWikiLink;
  }, [onNavigateWikiLink]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onHandleRef.current = onHandle; }, [onHandle]);
  useEffect(() => { onCursorRef.current = onCursorChange; }, [onCursorChange]);
  useEffect(() => { onSnippetRef.current = onSnippet; }, [onSnippet]);

  function snippetTarget(view: EditorView, request = requestEditorSnippet(view.state), separate?: boolean): SnippetTarget | undefined {
    if (!request || creationAllowed.current?.() === false) return;
    const { from, to } = request.selection.main;
    return { source: request.source.toString(), selection: request.source.sliceString(from, to), element: view.contentDOM,
      insert: (expansion) => creationAllowed.current?.() !== false && insertEditorSnippet(view, request, separate === undefined ? expansion : prepareBlockSnippet(expansion, { source: request.source.toString(), from: request.from, to: request.to }, separate)) };
  }
  function creationTarget(view: EditorView): EditorCreationTarget | undefined {
    const source = view.state.doc, selection = view.state.selection, key = currentDocument.current;
    const matches = () => view.dom.isConnected && !view.compositionStarted && !view.state.readOnly &&
      view.state.facet(EditorView.editable) && creationAllowed.current?.() !== false &&
      view.state.doc === source && view.state.selection.eq(selection) && currentDocument.current === key && selection.ranges.length === 1;
    if (!matches()) return;
    return {
      matches,
      block: (id, expectedSource) => matches() && currentBlocks.current.insertAt(view, id, expectedSource),
      snippet: () => matches() ? snippetTarget(view) : undefined,
    };
  }
  function snippetExtensions(index: SnippetIndex | undefined) {
    return index ? [editorSnippetFields(), createSnippetTriggers({ index, onExpand(view, request, definition) {
      const target = snippetTarget(view, request);
      return !!target && (onSnippetRef.current?.(definition, target) ?? false);
    } })] : [];
  }

  useEffect(() => {
    if (!hostRef.current) {
      return undefined;
    }
    let sourceRevision = 0;

    const preferenceId = viewKey ?? documentKey;
    const preferenceKey = preferenceId ? `slate.editor.${preferenceId}` : undefined;
    const source = documentSession?.snapshot().source ?? value ?? "";
    const initialValue = source.replace(/\r\n?/g, "\n");
    const binding = documentSession ? createEditorDocumentBinding(documentSession, (error) => {
      if (onDocumentErrorRef.current) onDocumentErrorRef.current(error); else throw error;
    }) : undefined;
    let position = { anchor: documentSession?.snapshot().state.selection.main.head ?? 0, scroll: 0 };
    try {
      const stored: unknown = preferenceKey ? JSON.parse(localStorage.getItem(preferenceKey) ?? "null") : null;
      if (typeof stored === "object" && stored !== null && "anchor" in stored && "scroll" in stored && typeof stored.anchor === "number" && typeof stored.scroll === "number") {
        position = { anchor: Math.min(Math.max(0, Math.trunc(stored.anchor)), initialValue.length), scroll: Math.max(0, stored.scroll) };
      }
    } catch { /* Invalid view preferences never prevent opening a file. */ }
    if (initialCursor !== undefined && Number.isFinite(initialCursor)) {
      const before = source.slice(0, Math.max(0, Math.min(source.length, Math.trunc(initialCursor))));
      position = { anchor: before.replace(/\r\n?/g, "\n").length, scroll: 0 };
    }
    // Reading scrollTop after a text update can force layout; scroll/pagehide refresh this cache.
    let observedScroll = position.scroll;
    const extensions = [
          editable.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.contentAttributes.of({ "aria-label": "Markdown editor", tabindex: "0" }),
          ...createSlateMarkdownExtensions({ history: !documentSession, formattingKeys: false, smartLists: false, selectionPairs: false, smartTables: false, smartPaste: false, fenceInput: false }),
          imageReader.current.of(onLoadImage ? imagePreviewLoader.of(onLoadImage) : []),
          tidyEditorHistory(source),
          tidyView.current.of(sourceViewExtensions(sourceMode)),
          writingModes.current.of(createWritingModeExtensions({ focus: writingFocus, typewriter, zen })),
          fenceRules.current.of(fenceInput.extension),
          pasteRules.current.of(paste.extension),
          tableKeys.current.of(createSmartTableBindings(smartTables)),
          smartListKeys.current.of(createSmartListBindings(smartLists)),
          pairs.current.of(createSelectionPairs(selectionPairs)),
          completions.current.of(createMarkdownCompletions({ sheets: completionSheets ?? [], tags: completionTags ?? [], wiki: wikiCompletion, tag: tagCompletion, date: dateCompletion, onPickDate: dates.open })),
          snippetRules.current.of(snippetExtensions(snippetIndex)),
          blocks.extension,
          gutter.extension,
          formattingKeys.current.of(createFormattingBindings(keymap)),
          wikiLinks.current.of(wikiExtensions(knownWikiTargets, completionSheets)),
          observeEditorSelection((rect) => { selectionGeometry.current = rect; setSelectionRect(rect); }, () => toolbarRef.current),
          EditorView.domEventHandlers({
            keydown(event) {
              if (event.key !== "Escape" || !selectionGeometry.current) return false;
              setDismissedSelection(selectionGeometry.current);
              event.preventDefault();
              return true;
            },
            mousedown(event, view) {
              if (event.button !== 0 || event.altKey || event.shiftKey) return false;
              const navigate = onNavigateWikiLinkRef.current;
              const target = event.target instanceof Element ? event.target : undefined;
              if (event.metaKey || event.ctrlKey) {
                const href = target?.closest<HTMLElement>("[data-slate-href]")?.dataset.slateHref;
                if (href && /^(https?:|mailto:)/i.test(href)) {
                  event.preventDefault();
                  window.open(href, "_blank", "noopener,noreferrer");
                  return true;
                }
              }
              if (!navigate || (!(event.metaKey || event.ctrlKey) && !target?.closest(".cm-slate-unresolved-link"))) return false;

              const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (position === null) {
                return false;
              }

              const link = findEditorWikiLink(view, position);
              if (!link) {
                return false;
              }

              event.preventDefault();
              navigate(link);
              return true;
            }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged || update.transactions.some((transaction) => editorSourceEffects(transaction).length)) sourceRevision++;
            if (update.selectionSet || update.docChanged) {
              const line = update.state.doc.lineAt(update.state.selection.main.head);
              onCursorRef.current?.({ line: line.number, column: update.state.selection.main.head - line.from + 1, lines: update.state.doc.lines });
            }
            if (!binding && update.docChanged && update.transactions.some((transaction) => transaction.docChanged && !transaction.annotation(externalValue))) {
              const changes: TextChange[] = [];
              update.changes.iterChanges((...change) => { changes.push({ from: change[0], to: change[1], text: change[4].toString() }); });
              const content = editorSource(update.state);
              lastEmittedValue.current = content;
              const history = update.transactions.some((transaction) => transaction.isUserEvent("undo") || transaction.isUserEvent("redo"));
              const tidy = update.transactions.some((transaction) => transaction.isUserEvent("input.tidy"));
              onChangeRef.current?.(content, changes, history ? "history" : tidy ? "tidy" : "input");
            }
            if (preferenceKey && (update.selectionSet || update.docChanged)) {
              try { localStorage.setItem(preferenceKey, JSON.stringify({ anchor: update.state.selection.main.head, scroll: observedScroll })); } catch { /* View preferences are optional. */ }
            }
          })
    ];
    const selection = { anchor: position.anchor };
    const state = binding?.state(extensions, selection) ?? EditorState.create({ doc: initialValue, selection, extensions });
    const view = new EditorView({ parent: hostRef.current, state });
    const disconnect = binding?.connect(view);

    viewRef.current = view;
    onHandleRef.current?.({
      documentKey: () => currentDocument.current,
      source: () => editorSource(view.state),
      applyTidy: (result) => applyEditorTidy(view, result),
      runTable(id) { const applied = runTableCommand(view, id); if (applied) view.focus(); return applied; },
      tableColumns() { return editorTableColumns(view.state); },
      runFormat(id) { const applied = runFormattingCommand(view, id); if (applied) view.focus(); return applied; },
      focus(reveal = false) { view.focus(); if (reveal) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main, { y: "center" }), annotations: Transaction.addToHistory.of(false) }); },
      hasFocus() { return view.hasFocus; },
      hasSelection() { return !view.state.selection.main.empty; },
      selectedText() { const { from, to } = view.state.selection.main; return view.state.sliceDoc(from, to); },
      snippetTarget() { return snippetTarget(view); },
      creationTarget() { return creationTarget(view); },
      sectionTarget(source) {
        const key = currentDocument.current, revision = sourceRevision;
        const sessionRevision = documentSession?.snapshot().revision;
        return editorSectionTarget(view, source, () => currentDocument.current === key && sourceRevision === revision &&
          creationAllowed.current?.() !== false && (!documentSession || documentSession.canEdit() && documentSession.snapshot().revision === sessionRevision));
      },
      goToSourceOffset(source, offset) {
        if (!view.dom.isConnected || editorSource(view.state) !== source || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length) return false;
        const anchor = source.slice(0, offset).replace(/\r\n?/g, "\n").length;
        view.dispatch({ selection: { anchor }, scrollIntoView: true }); view.focus(); return true;
      },
      goToLine(number) { const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, Math.trunc(number)))); view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true }); view.focus(); }
    });
    const initialLine = view.state.doc.lineAt(view.state.selection.main.head);
    onCursorRef.current?.({ line: initialLine.number, column: view.state.selection.main.head - initialLine.from + 1, lines: view.state.doc.lines });
    const readyFrame = requestAnimationFrame(() => {
      if (initialCursor !== undefined) { view.dispatch({ scrollIntoView: true }); view.focus(); }
      onReadyRef.current?.();
    });
    const scroll = () => {
      if (preferenceKey) {
        observedScroll = view.scrollDOM.scrollTop;
        try { localStorage.setItem(preferenceKey, JSON.stringify({ anchor: view.state.selection.main.head, scroll: observedScroll })); } catch { /* View preferences are optional. */ }
      }
    };
    view.requestMeasure({ read: () => position.scroll, write(scrollTop) { view.scrollDOM.scrollTop = scrollTop; } });
    view.scrollDOM.addEventListener("scroll", scroll);
    window.addEventListener("pagehide", scroll);
    return () => {
      disconnect?.();
      cancelAnimationFrame(readyFrame);
      if (view.dom.isConnected) scroll();
      view.scrollDOM.removeEventListener("scroll", scroll);
      window.removeEventListener("pagehide", scroll);
      view.destroy();
      viewRef.current = null;
      onHandleRef.current?.(undefined);
    };
  }, [documentSession, viewKey]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: [
      tidyView.current.reconfigure(sourceViewExtensions(sourceMode)),
      editorTidyLines(sourceMode ? tidyLines ?? [] : []),
    ], annotations: Transaction.addToHistory.of(false) });
  }, [sourceMode, tidyLines]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: writingModes.current.reconfigure(createWritingModeExtensions({ focus: writingFocus, typewriter, zen })), annotations: Transaction.addToHistory.of(false) });
  }, [writingFocus, typewriter, zen]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: imageReader.current.reconfigure(onLoadImage ? imagePreviewLoader.of(onLoadImage) : []) });
  }, [onLoadImage]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: formattingKeys.current.reconfigure(createFormattingBindings(keymap)) });
  }, [keymap]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: smartListKeys.current.reconfigure(createSmartListBindings(smartLists)) });
  }, [smartLists]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: tableKeys.current.reconfigure(createSmartTableBindings(smartTables)) });
  }, [smartTables]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: pairs.current.reconfigure(createSelectionPairs(selectionPairs)) });
  }, [selectionPairs]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: completions.current.reconfigure(createMarkdownCompletions({ sheets: completionSheets ?? [], tags: completionTags ?? [], wiki: wikiCompletion, tag: tagCompletion, date: dateCompletion, onPickDate: dates.open })) });
  }, [completionSheets, completionTags, wikiCompletion, tagCompletion, dateCompletion, dates.open]);
  useEffect(() => { viewRef.current?.dispatch({ effects: snippetRules.current.reconfigure(snippetExtensions(snippetIndex)) }); }, [snippetIndex]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: pasteRules.current.reconfigure(paste.extension) });
  }, [paste.extension]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: fenceRules.current.reconfigure(fenceInput.extension) });
  }, [fenceInput.extension]);

  useEffect(() => {
    const previous = previousWikiTargets.current;
    const previousSheets = previousCompletionSheets.current;
    previousWikiTargets.current = knownWikiTargets;
    previousCompletionSheets.current = completionSheets;
    if (previousSheets === completionSheets && (previous === knownWikiTargets || previous?.size === knownWikiTargets?.size && [...(previous ?? [])].every((target) => knownWikiTargets?.has(target)))) return;
    viewRef.current?.dispatch({ effects: wikiLinks.current.reconfigure(wikiExtensions(knownWikiTargets, completionSheets)) });
  }, [knownWikiTargets, completionSheets]);

  useEffect(() => {
    if (documentSession || value === undefined) return;
    const view = viewRef.current;
    if (!view) return;
    if (value === lastEmittedValue.current) { lastEmittedValue.current = undefined; return; }
    lastEmittedValue.current = undefined;
    const previous = view.state.doc.toString();
    const normalized = value.replace(/\r\n?/g, "\n");
    if (previous === normalized) {
      if (editorSource(view.state) !== value) view.dispatch({ effects: editorSourceEffect(value), annotations: Transaction.addToHistory.of(false) });
      return;
    }

    view.dispatch({
      changes: documentChange(previous, normalized),
      effects: editorSourceEffect(value),
      annotations: [externalValue.of(true), Transaction.addToHistory.of(false)]
    });
  }, [value, documentSession]);

  return <>{blocks.menu}{gutter.dialog}{dates.dialog}{fenceInput.dialog}{paste.notices}<div ref={hostRef} className={sourceMode ? "editorHost tidySourceEditor" : "editorHost"} aria-label="Markdown editor" />{!readOnly && selectionRect && selectionRect !== dismissedSelection && <SelectionToolbar rect={selectionRect} toolbarRef={toolbarRef} keymap={keymap} onCommand={(id) => { const view = viewRef.current; if (view && runFormattingCommand(view, id)) view.focus(); }} onEscape={() => { setDismissedSelection(selectionRect); viewRef.current?.focus(); }} />}</>;
});
