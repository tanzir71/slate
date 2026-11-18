import { useCallback, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { isIsoDate } from "@slate/core";
import {
  requestEditorDate,
  insertEditorDate,
  type EditorDateRequest,
} from "@slate/editor";
import { DatePicker } from "./DatePicker";

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function useDatePicker(enabled: boolean) {
  const [request, setRequest] = useState<{
    view: EditorView;
    input: EditorDateRequest;
  }>();
  const open = useCallback(
    (view: EditorView) => {
      const input = requestEditorDate(view.state);
      if (enabled && input && view.dom.isConnected) setRequest({ view, input });
    },
    [enabled],
  );
  function close() {
    setRequest(undefined);
    if (request?.view.dom.isConnected) request.view.focus();
  }
  function choose(date: string) {
    if (
      !enabled ||
      !request ||
      !insertEditorDate(request.view, request.input, date)
    )
      return false;
    close();
    return true;
  }
  return {
    open,
    dialog: request ? (
      <DatePicker
        initialDate={
          isIsoDate(request.input.query.query)
            ? request.input.query.query
            : today()
        }
        onChoose={choose}
        onClose={close}
      />
    ) : null,
  };
}
