import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { computeEditorHud, findWikiLinkAtPosition } from "../src/index";
import {
  createSlateMarkdownExtensions,
  toggleEditorTask,
  wrapEditorSelection,
} from "../src/index";
import { undo } from "@codemirror/commands";

describe("editor helpers", () => {
  it("formats a selection with one undo and toggles a Markdown task", () => {
    const host = document.createElement("div");
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "my words\n- [ ] task",
        selection: { anchor: 0, head: 8 },
        extensions: createSlateMarkdownExtensions(),
      }),
    });
    expect(wrapEditorSelection(view, "*")).toBe(true);
    expect(view.state.doc.toString()).toBe("*my words*\n- [ ] task");
    undo(view);
    expect(view.state.doc.toString()).toBe("my words\n- [ ] task");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(toggleEditorTask(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("my words\n- [x] task");
    view.destroy();
  });
  it("computes the live HUD from Markdown text", () => {
    expect(
      computeEditorHud("# Title\n\nDraft copy for #writing/work."),
    ).toMatchObject({
      words: 5,
      characters: 24,
      readingTimeMinutes: 1,
    });
  });

  it("finds a wiki-link target at a document position", () => {
    const markdown =
      "See [[Product Vision|vision]] and [[id:01J22222222222222222222222|renamed]].";

    expect(
      findWikiLinkAtPosition(markdown, markdown.indexOf("Vision")),
    ).toEqual({
      from: 4,
      to: 29,
      raw: "[[Product Vision|vision]]",
      target: "Product Vision",
      display: "vision",
      targetId: undefined,
    });
    expect(
      findWikiLinkAtPosition(markdown, markdown.indexOf("renamed")),
    ).toMatchObject({
      target: "01J22222222222222222222222",
      targetId: "01J22222222222222222222222",
      display: "renamed",
    });
    expect(findWikiLinkAtPosition(markdown, 1)).toBeUndefined();
  });
});
