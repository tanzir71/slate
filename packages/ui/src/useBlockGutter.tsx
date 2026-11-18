import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { currentEditorBlock, moveEditorBlock } from "@slate/editor";
import { planMarkdownBlockMove } from "@slate/core";
import { WorkspaceDialog } from "./browser/WorkspaceDialog";
import {
  createBlockGutterController,
  type BlockGutterRequest,
} from "./blockGutterController";
import "./blockGutter.css";

export function useBlockGutter(
  onInsert: (request: BlockGutterRequest) => void,
) {
  const [request, setRequest] = useState<BlockGutterRequest>();
  const [error, setError] = useState("");
  const insert = useRef(onInsert);
  useLayoutEffect(() => {
    insert.current = onInsert;
  }, [onInsert]);
  const extension = useMemo(
    () =>
      createBlockGutterController((next) => {
        if (next.kind === "insert") insert.current(next);
        else {
          setError("");
          setRequest(next);
        }
      }),
    [],
  );
  function close() {
    setRequest(undefined);
    request?.view.focus();
  }
  function act(action: () => boolean) {
    if (
      !request ||
      !currentEditorBlock(request.view, request.target) ||
      !action()
    ) {
      setError(
        "The sheet changed or is read-only. Close this menu and choose the block again.",
      );
      return;
    }
    close();
  }
  const target = request?.target;
  return {
    extension,
    dialog: request && target && (
      <WorkspaceDialog
        title="Block actions"
        returnFocus={request.view.contentDOM}
        onClose={close}
        className="blockActionsDialog"
      >
        <p>{target.block.label}</p>
        {error && <p role="alert">{error}</p>}
        <div className="blockActionsList">
          <button
            onClick={() =>
              act(() => {
                insert.current(request);
                return true;
              })
            }
          >
            Insert block after
          </button>
          <button
            disabled={
              target.index <= 0 ||
              !planMarkdownBlockMove(
                target.document,
                target.index,
                target.index - 1,
              )
            }
            onClick={() =>
              act(() => moveEditorBlock(request.view, target, target.index - 1))
            }
          >
            Move block up
          </button>
          <button
            disabled={
              target.index < 0 ||
              target.index >= target.document.blocks.length - 1 ||
              !planMarkdownBlockMove(
                target.document,
                target.index,
                target.index + 2,
              )
            }
            onClick={() =>
              act(() => moveEditorBlock(request.view, target, target.index + 2))
            }
          >
            Move block down
          </button>
          <button
            disabled={target.index < 0}
            onClick={() =>
              act(() => {
                request.view.dispatch({
                  selection: {
                    anchor: target.block.from,
                    head: target.block.to,
                  },
                  scrollIntoView: true,
                });
                return true;
              })
            }
          >
            Select block to format
          </button>
        </div>
      </WorkspaceDialog>
    ),
  };
}
