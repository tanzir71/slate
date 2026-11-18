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

it("handles an open menu before a platform input listener can defer Enter", () => {
  const onKey = vi.fn((event: KeyboardEvent) => event.key === "Enter");
  const controller = createBlockMenuController(() => undefined, onKey);
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      extensions: [createSlateMarkdownExtensions(), controller.extension],
    }),
  });
  try {
    view.focus();
    view.dispatch({
      changes: { from: 0, insert: "/ta" },
      selection: { anchor: 3 },
    });
    // Android's editor listener consumes Enter before extension key handlers.
    // A rapid key without a DOM change may never be replayed by that listener.
    const platformInput = vi.fn((event: Event) => {
      if (!event.defaultPrevented) event.stopImmediatePropagation();
    });
    view.contentDOM.addEventListener("keydown", platformInput, true);
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      keyCode: 13,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    expect(onKey).toHaveBeenCalledExactlyOnceWith(event, view, {
      from: 0,
      to: 3,
      query: "ta",
    });
    expect(event.defaultPrevented).toBe(true);
    onKey.mockClear();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
    expect(onKey).not.toHaveBeenCalled();
    controller.close(view);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onKey).not.toHaveBeenCalled();
    view.contentDOM.removeEventListener("keydown", platformInput, true);
  } finally {
    view.destroy();
    parent.remove();
  }
});

it("lets CodeMirror flush pending native text before handling a menu key", () => {
  const onKey = vi.fn((event: KeyboardEvent) => event.key === "Enter");
  const controller = createBlockMenuController(() => undefined, onKey);
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      extensions: [createSlateMarkdownExtensions(), controller.extension],
    }),
  });
  try {
    view.focus();
    view.dispatch({
      changes: { from: 0, insert: "/t" },
      selection: { anchor: 2 },
    });
    const point = view.domAtPos(2);
    expect(point.node.nodeType).toBe(Node.TEXT_NODE);
    point.node.textContent = "/ta";
    document.getSelection()!.collapse(point.node, 3);
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      keyCode: 13,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    expect(view.state.doc.toString()).toBe("/ta");
    expect(onKey).toHaveBeenCalledExactlyOnceWith(event, view, {
      from: 0,
      to: 3,
      query: "ta",
    });
    expect(event.defaultPrevented).toBe(true);
  } finally {
    view.destroy();
    parent.remove();
  }
});
