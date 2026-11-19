import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, it } from "vitest";
import { fix } from "../../core/src/tidy/index";
import {
  applyEditorTidy,
  editorSource,
  editorSourceEffect,
  editorTidyLines,
  tidyEditorHistory,
} from "../src/tidy";
import {
  createSlateMarkdownExtensions,
  livePreviewSettings,
} from "../src/index";

const normalized = (source: string) => source.replace(/\r\n?/g, "\n");

it("tints only reported lines, clears them immediately on edit and leaves undo untouched", () => {
  const { view, close } = editor("first\nsecond\nthird");
  try {
    view.dispatch({ effects: editorTidyLines([3, 1, 1, 999, -1, 1.5]) });
    expect(
      [...view.contentDOM.querySelectorAll(".cm-tidy-line")].map(
        (line) => line.textContent,
      ),
    ).toEqual(["first", "third"]);
    expect(undoDepth(view.state)).toBe(0);
    view.dispatch({ changes: { from: 0, insert: "A" } });
    expect(view.contentDOM.querySelectorAll(".cm-tidy-line")).toHaveLength(0);
    expect(undo(view)).toBe(true);
    expect(editorSource(view.state)).toBe("first\nsecond\nthird");
    expect(view.contentDOM.querySelectorAll(".cm-tidy-line")).toHaveLength(0);
  } finally {
    close();
  }
});

it("shows literal source markers during review and restores Live rendering without a document edit", () => {
  const parent = document.body.appendChild(document.createElement("div"));
  const mode = new Compartment();
  const source = "# Title\n\n**Bold**\n\n- [x] Task";
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [createSlateMarkdownExtensions(), mode.of([])],
    }),
  });
  try {
    expect(view.contentDOM.textContent).not.toContain("**Bold**");
    view.dispatch({
      effects: mode.reconfigure(
        livePreviewSettings.of({
          sourceMode: true,
          hideSyntax: false,
          highContrastMarkers: false,
        }),
      ),
    });
    expect(view.contentDOM.textContent).toContain("**Bold**");
    expect(view.contentDOM.textContent).toContain("- [x] Task");
    expect(
      view.contentDOM.querySelectorAll('input[type="checkbox"]'),
    ).toHaveLength(0);
    expect(view.state.doc.toString()).toBe(source);
    view.dispatch({ effects: mode.reconfigure([]) });
    expect(view.contentDOM.textContent).not.toContain("**Bold**");
    expect(view.state.doc.toString()).toBe(source);
    expect(undoDepth(view.state)).toBe(0);
  } finally {
    view.destroy();
    parent.remove();
  }
});
function editor(source: string, readOnly = false, install = true) {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: normalized(source),
      extensions: [
        history(),
        EditorState.readOnly.of(readOnly),
        install ? tidyEditorHistory(source) : [],
      ],
    }),
  });
  return {
    view,
    close() {
      view.destroy();
      parent.remove();
    },
  };
}

it.each(["\n", "\r\n", "\r"])(
  "applies a guarded result in one undo while retaining exact %j source and BOM",
  (eol) => {
    const source = ["\uFEFF#   Draft", "", "+ One", "+ Two"].join(eol);
    const { view, close } = editor(source);
    try {
      const result = fix(source);
      expect(applyEditorTidy(view, result)).toBe(true);
      expect(editorSource(view.state)).toBe(result.output);
      expect(view.state.doc.toString()).toBe(normalized(result.output));
      expect(undoDepth(view.state)).toBe(1);
      expect(undo(view)).toBe(true);
      expect(editorSource(view.state)).toBe(source);
      expect(redo(view)).toBe(true);
      expect(editorSource(view.state)).toBe(result.output);
    } finally {
      close();
    }
  },
);

it("keeps subsequent typing separately undoable and restores the raw Tidy snapshot across undo/redo", () => {
  const source = "#   Draft\r\n\r\n+ One\r\n";
  const { view, close } = editor(source);
  try {
    const result = fix(source);
    expect(applyEditorTidy(view, result)).toBe(true);
    view.dispatch({
      changes: { from: 0, insert: "A" },
      annotations: Transaction.userEvent.of("input.type"),
    });
    expect(editorSource(view.state)).toBe("A" + normalized(result.output));
    expect(undo(view)).toBe(true);
    expect(editorSource(view.state)).toBe(result.output);
    expect(undo(view)).toBe(true);
    expect(editorSource(view.state)).toBe(source);
    expect(redo(view)).toBe(true);
    expect(editorSource(view.state)).toBe(result.output);
    expect(redo(view)).toBe(true);
    expect(editorSource(view.state)).toBe("A" + normalized(result.output));
  } finally {
    close();
  }
});

it("rejects stale, read-only, incomplete and invalid proposals without changing the document/history", () => {
  const source = "#   Draft";
  for (const [readOnly, install] of [
    [true, true],
    [false, false],
    [false, true],
  ]) {
    const { view, close } = editor(source, readOnly, install);
    try {
      const result = fix(source);
      if (readOnly || !install)
        expect(applyEditorTidy(view, result)).toBe(false);
      else {
        expect(applyEditorTidy(view, { ...result, source: "different" })).toBe(
          false,
        );
        expect(applyEditorTidy(view, { ...result, output: "unmatched" })).toBe(
          false,
        );
        expect(
          applyEditorTidy(view, {
            ...result,
            changes: [{ from: 0, to: 999, text: "" }],
          }),
        ).toBe(false);
      }
      expect(editorSource(view.state)).toBe(source);
      expect(undoDepth(view.state)).toBe(0);
    } finally {
      close();
    }
  }
});

it("ignores a clean result and tracks externally replaced raw source without adding an undo", () => {
  const { view, close } = editor("# Draft\n");
  try {
    expect(applyEditorTidy(view, fix("# Draft\n"))).toBe(false);
    const external = "# External\r\n";
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: normalized(external),
      },
      effects: editorSourceEffect(external),
      annotations: Transaction.addToHistory.of(false),
    });
    expect(editorSource(view.state)).toBe(external);
    expect(undoDepth(view.state)).toBe(0);
    const result = fix(external);
    expect(applyEditorTidy(view, result)).toBe(false);
  } finally {
    close();
  }
});
