import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createSlateMarkdownExtensions } from "@slate/editor";
import { expect, it, vi } from "vitest";
import { createBlockMenuController } from "../src/blockMenuController";

it("does not measure ordinary typing and uses a pre-input anchor to publish a slash without waiting another frame", async () => {
  const changes = vi.fn();
  const controller = createBlockMenuController(changes, () => false);
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      extensions: [createSlateMarkdownExtensions(), controller.extension],
    }),
  });
  try {
    view.focus();
    const geometry = vi
      .spyOn(view, "coordsAtPos")
      .mockReturnValue({ left: 10, right: 11, top: 20, bottom: 40 });
    vi.spyOn(view, "requestMeasure").mockImplementation(() => undefined);
    view.contentDOM.dispatchEvent(
      new InputEvent("beforeinput", {
        data: "x",
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
      }),
    );
    view.dispatch({
      changes: { from: 0, insert: "x " },
      selection: { anchor: 2 },
    });
    await Promise.resolve();
    expect(geometry).not.toHaveBeenCalled();
    expect(changes).not.toHaveBeenCalled();
    view.contentDOM.dispatchEvent(
      new InputEvent("beforeinput", {
        data: "/",
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
      }),
    );
    view.dispatch({
      changes: { from: 2, insert: "/" },
      selection: { anchor: 3 },
    });
    await Promise.resolve();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: 2,
        to: 3,
        query: "",
        rect: { left: 10, right: 11, top: 20, bottom: 40 },
      }),
    );
    controller.close(view);
    view.contentDOM.dispatchEvent(new FocusEvent("focus"));
    await Promise.resolve();
    expect(changes).toHaveBeenLastCalledWith(undefined);
  } finally {
    view.destroy();
    parent.remove();
  }
});
