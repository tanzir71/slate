import { useCallback, useMemo, useRef, useState } from "react";
import {
  chooseEditorFenceLanguage,
  createFenceInput,
  type EditorFenceRequest,
} from "@slate/editor";
import type { EditorView } from "@codemirror/view";
import { BlockResourcePicker } from "./BlockResourcePicker";

export function useFenceInput(fences: boolean, frontmatter: boolean) {
  const [request, setRequest] = useState<{
    id: number;
    view: EditorView;
    input: EditorFenceRequest;
  }>();
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const open = useCallback((view: EditorView, input: EditorFenceRequest) => {
    setError("");
    setRequest({ view, input, id: ++sequence.current });
  }, []);
  const extension = useMemo(
    () => createFenceInput({ fences, frontmatter, onPickLanguage: open }),
    [fences, frontmatter, open],
  );
  function close() {
    setRequest(undefined);
    if (request?.view.dom.isConnected) request.view.focus();
  }
  return {
    extension,
    dialog: request ? (
      <BlockResourcePicker
        key={request.id}
        kind="language"
        onImage={undefined}
        submitLabel="Set language"
        errorMessage={error}
        onChoose={(context) => {
          if (
            !fences ||
            !chooseEditorFenceLanguage(
              request.view,
              request.input,
              context.language ?? "",
            )
          ) {
            setError(
              "The sheet or editor settings changed. Close the picker and try again.",
            );
            return;
          }
          close();
        }}
        onClose={close}
      />
    ) : null,
  };
}
