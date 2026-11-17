import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createSlateMarkdownExtensions,
  findWikiLinkAtPosition,
  type WikiLinkHit
} from "@slate/editor";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onNavigateWikiLink?: (link: WikiLinkHit) => void;
  readOnly?: boolean;
  documentKey?: string;
}

export function MarkdownEditor({ value, onChange, onNavigateWikiLink, readOnly = false, documentKey }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onNavigateWikiLinkRef = useRef(onNavigateWikiLink);
  const editable = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onNavigateWikiLinkRef.current = onNavigateWikiLink;
  }, [onNavigateWikiLink]);

  useEffect(() => {
    if (!hostRef.current) {
      return undefined;
    }

    const preferenceKey = documentKey ? `slate.editor.${documentKey}` : undefined;
    let position = { anchor: 0, scroll: 0 };
    try {
      const stored: unknown = preferenceKey ? JSON.parse(localStorage.getItem(preferenceKey) ?? "null") : null;
      if (typeof stored === "object" && stored !== null && "anchor" in stored && "scroll" in stored && typeof stored.anchor === "number" && typeof stored.scroll === "number") {
        position = { anchor: Math.min(Math.max(0, stored.anchor), value.length), scroll: Math.max(0, stored.scroll) };
      }
    } catch { /* Invalid view preferences never prevent opening a file. */ }
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        selection: { anchor: position.anchor },
        extensions: [
          editable.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.contentAttributes.of({ "aria-label": "Markdown editor" }),
          ...createSlateMarkdownExtensions(),
          EditorView.domEventHandlers({
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
            if (update.docChanged) {
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
    const scroll = () => {
      if (preferenceKey) {
        try { localStorage.setItem(preferenceKey, JSON.stringify({ anchor: view.state.selection.main.head, scroll: view.scrollDOM.scrollTop })); } catch { /* View preferences are optional. */ }
      }
    };
    view.requestMeasure({ read: () => position.scroll, write(scrollTop) { view.scrollDOM.scrollTop = scrollTop; } });
    view.scrollDOM.addEventListener("scroll", scroll);
    return () => {
      view.scrollDOM.removeEventListener("scroll", scroll);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) {
      return;
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    });
  }, [value]);

  return <div ref={hostRef} className="editorHost" aria-label="Markdown editor" />;
}
