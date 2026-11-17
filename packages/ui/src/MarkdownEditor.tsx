import { useEffect, useRef, useState } from "react";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createSlateMarkdownExtensions,
  createFormattingBindings,
  runFormattingCommand,
  findWikiLinkAtPosition,
  type WikiLinkHit
} from "@slate/editor";
import type { ResolvedKeymap } from "@slate/core";
import type { MarkdownEditorHandle } from "./commands";
import { observeEditorSelection, type ToolbarRect } from "./selectionGeometry";
import { SelectionToolbar } from "./SelectionToolbar";

const externalValue = Annotation.define<boolean>();

function documentChange(previous: string, next: string) {
  let from = 0;
  while (from < previous.length && from < next.length && previous[from] === next[from]) from++;
  let to = previous.length;
  let end = next.length;
  while (to > from && end > from && previous[to - 1] === next[end - 1]) { to--; end--; }
  return { from, to, insert: next.slice(from, end) };
}

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onNavigateWikiLink?: (link: WikiLinkHit) => void;
  readOnly?: boolean;
  documentKey?: string;
  onReady?: () => void;
  keymap?: ResolvedKeymap;
  onHandle?: (handle: MarkdownEditorHandle | undefined) => void;
}

export function MarkdownEditor({ value, onChange, onNavigateWikiLink, readOnly = false, documentKey, onReady, keymap, onHandle }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onNavigateWikiLinkRef = useRef(onNavigateWikiLink);
  const onReadyRef = useRef(onReady);
  const editable = useRef(new Compartment());
  const formattingKeys = useRef(new Compartment());
  const onHandleRef = useRef(onHandle);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [selectionRect, setSelectionRect] = useState<ToolbarRect>();
  const [dismissedSelection, setDismissedSelection] = useState<ToolbarRect>();
  const selectionGeometry = useRef<ToolbarRect | undefined>(undefined);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onNavigateWikiLinkRef.current = onNavigateWikiLink;
  }, [onNavigateWikiLink]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onHandleRef.current = onHandle; }, [onHandle]);

  useEffect(() => {
    if (!hostRef.current) {
      return undefined;
    }

    const preferenceKey = documentKey ? `slate.editor.${documentKey}` : undefined;
    const initialValue = value.replace(/\r\n?/g, "\n");
    let position = { anchor: 0, scroll: 0 };
    try {
      const stored: unknown = preferenceKey ? JSON.parse(localStorage.getItem(preferenceKey) ?? "null") : null;
      if (typeof stored === "object" && stored !== null && "anchor" in stored && "scroll" in stored && typeof stored.anchor === "number" && typeof stored.scroll === "number") {
        position = { anchor: Math.min(Math.max(0, Math.trunc(stored.anchor)), initialValue.length), scroll: Math.max(0, stored.scroll) };
      }
    } catch { /* Invalid view preferences never prevent opening a file. */ }
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValue,
        selection: { anchor: position.anchor },
        extensions: [
          editable.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.contentAttributes.of({ "aria-label": "Markdown editor" }),
          ...createSlateMarkdownExtensions({ formattingKeys: false }),
          formattingKeys.current.of(createFormattingBindings(keymap)),
          observeEditorSelection((rect) => { selectionGeometry.current = rect; setSelectionRect(rect); }, () => toolbarRef.current),
          EditorView.domEventHandlers({
            keydown(event) {
              if (event.key !== "Escape" || !selectionGeometry.current) return false;
              setDismissedSelection(selectionGeometry.current);
              event.preventDefault();
              return true;
            },
            mousedown(event, view) {
              const navigate = onNavigateWikiLinkRef.current;
              if (!navigate || !(event.metaKey || event.ctrlKey)) {
                return false;
              }

              const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (position === null) {
                return false;
              }

              const link = findWikiLinkAtPosition(view.state.doc.toString(), position);
              if (!link) {
                return false;
              }

              event.preventDefault();
              navigate(link);
              return true;
            }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && update.transactions.some((transaction) => transaction.docChanged && !transaction.annotation(externalValue))) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (preferenceKey && (update.selectionSet || update.docChanged)) {
              try { localStorage.setItem(preferenceKey, JSON.stringify({ anchor: update.state.selection.main.head, scroll: update.view.scrollDOM.scrollTop })); } catch { /* View preferences are optional. */ }
            }
          })
        ]
      })
    });

    viewRef.current = view;
    onHandleRef.current?.({
      runFormat(id) { const applied = runFormattingCommand(view, id); if (applied) view.focus(); return applied; },
      focus() { view.focus(); },
      hasFocus() { return view.hasFocus; },
      hasSelection() { return !view.state.selection.main.empty; }
    });
    const readyFrame = requestAnimationFrame(() => onReadyRef.current?.());
    const scroll = () => {
      if (preferenceKey) {
        try { localStorage.setItem(preferenceKey, JSON.stringify({ anchor: view.state.selection.main.head, scroll: view.scrollDOM.scrollTop })); } catch { /* View preferences are optional. */ }
      }
    };
    view.requestMeasure({ read: () => position.scroll, write(scrollTop) { view.scrollDOM.scrollTop = scrollTop; } });
    view.scrollDOM.addEventListener("scroll", scroll);
    window.addEventListener("pagehide", scroll);
    return () => {
      cancelAnimationFrame(readyFrame);
      if (view.dom.isConnected) scroll();
      view.scrollDOM.removeEventListener("scroll", scroll);
      window.removeEventListener("pagehide", scroll);
      view.destroy();
      viewRef.current = null;
      onHandleRef.current?.(undefined);
    };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: formattingKeys.current.reconfigure(createFormattingBindings(keymap)) });
  }, [keymap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const previous = view.state.doc.toString();
    const normalized = value.replace(/\r\n?/g, "\n");
    if (previous === normalized) return;

    view.dispatch({
      changes: documentChange(previous, normalized),
      annotations: [externalValue.of(true), Transaction.addToHistory.of(false)]
    });
  }, [value]);

  return <><div ref={hostRef} className="editorHost" aria-label="Markdown editor" />{!readOnly && selectionRect && selectionRect !== dismissedSelection && <SelectionToolbar rect={selectionRect} toolbarRef={toolbarRef} keymap={keymap} onCommand={(id) => { const view = viewRef.current; if (view && runFormattingCommand(view, id)) view.focus(); }} onEscape={() => { setDismissedSelection(selectionRect); viewRef.current?.focus(); }} />}</>;
}
