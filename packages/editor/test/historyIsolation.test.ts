import { isolateHistory, undo, redo } from "@codemirror/commands";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import { expect, it } from "vitest";
import { createSlateMarkdownExtensions } from "../src/index";

it("starts a new composition after an isolated smart edit and keeps its following IME updates together", () => {
  const marker = "---";
  let state = EditorState.create({
    doc: marker,
    extensions: createSlateMarkdownExtensions(),
  });
  const apply = (transaction: Transaction) => {
    state = transaction.state;
  };
  state = state.update({
    changes: { from: 3, insert: "\n\n---" },
    annotations: isolateHistory.of("full"),
    userEvent: "input.fence",
  }).state;
  const metadata = Annotation.define<string>();
  const first = state.update({
    changes: { from: 4, insert: "ন" },
    userEvent: "input.type.compose",
    annotations: metadata.of("kept"),
  });
  expect(first.annotation(metadata)).toBe("kept");
  apply(first);
  state = state.update({
    changes: { from: 4, to: 5, insert: "নোট" },
    userEvent: "input.type.compose",
  }).state;
  expect(state.doc.toString()).toBe("---\nনোট\n---");
  expect(undo({ state, dispatch: apply })).toBe(true);
  expect(state.doc.toString()).toBe("---\n\n---");
  expect(redo({ state, dispatch: apply })).toBe(true);
  expect(state.doc.toString()).toBe("---\nনোট\n---");
  expect(undo({ state, dispatch: apply })).toBe(true);
  expect(undo({ state, dispatch: apply })).toBe(true);
  expect(state.doc.toString()).toBe(marker);
});

it("retains native grouping for ordinary typing and composition updates", () => {
  let state = EditorState.create({
    extensions: createSlateMarkdownExtensions(),
  });
  state = state.update({
    changes: { from: 0, insert: "A" },
    userEvent: "input.type",
  }).state;
  state = state.update({
    changes: { from: 1, insert: "B" },
    userEvent: "input.type.compose",
  }).state;
  expect(
    undo({
      state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    }),
  ).toBe(true);
  expect(state.doc.toString()).toBe("");
});

it.each(["undo", "redo"])(
  "keeps a new composition separate after %s",
  (direction) => {
    let state = EditorState.create({
      extensions: createSlateMarkdownExtensions(),
    });
    const apply = (transaction: Transaction) => {
      state = transaction.state;
    };
    state = state.update({
      changes: { from: 0, insert: "A" },
      userEvent: "input.type",
    }).state;
    state = state.update({
      changes: { from: 1, insert: "!" },
      userEvent: "input.fence",
      annotations: isolateHistory.of("full"),
    }).state;
    undo({ state, dispatch: apply });
    if (direction === "redo") redo({ state, dispatch: apply });
    const before = state.doc.toString();
    state = state.update({
      changes: { from: state.doc.length, insert: "ন" },
      userEvent: "input.type.compose",
    }).state;
    undo({ state, dispatch: apply });
    expect(state.doc.toString()).toBe(before);
  },
);
