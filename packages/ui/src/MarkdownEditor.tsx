import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
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
}

export function MarkdownEditor({ value, onChange, onNavigateWikiLink }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onNavigateWikiLinkRef = useRef(onNavigateWikiLink);

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

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
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
          })
        ]
      })
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

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
