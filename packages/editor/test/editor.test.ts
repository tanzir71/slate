import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  computeEditorHud,
  createInvisibleMarkdownExtension,
  findInactiveMarkdownMarkerRanges,
  findWikiLinkAtPosition
} from "../src/index";
import { createSlateMarkdownExtensions, toggleEditorTask, wrapEditorSelection } from "../src/index";
import { undo } from "@codemirror/commands";

describe("editor helpers", () => {
  it("formats a selection with one undo and toggles a Markdown task", () => {
    const host = document.createElement("div");
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: "my words\n- [ ] task", selection: { anchor: 0, head: 8 }, extensions: createSlateMarkdownExtensions() }) });
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
    expect(computeEditorHud("# Title\n\nDraft copy for #writing/work.")).toMatchObject({
      words: 5,
      characters: 24,
      readingTimeMinutes: 1
    });
  });

  it("finds Markdown syntax markers outside the active line for Bear-style hiding", () => {
    const markdown = "# Title\n\nThis is **bold** and [[Target|label]].\nActive **line**.";
    const ranges = findInactiveMarkdownMarkerRanges(markdown, 4);

    expect(ranges.map((range) => markdown.slice(range.from, range.to))).toEqual([
      "#",
      "**",
      "**",
      "[[",
      "|",
      "]]"
    ]);
    expect(ranges.every((range) => range.line !== 4)).toBe(true);
  });

  it("finds a wiki-link target at a document position", () => {
    const markdown = "See [[Product Vision|vision]] and [[id:01J22222222222222222222222|renamed]].";

    expect(findWikiLinkAtPosition(markdown, markdown.indexOf("Vision"))).toEqual({
      from: 4,
      to: 29,
      raw: "[[Product Vision|vision]]",
      target: "Product Vision",
      display: "vision",
      targetId: undefined
    });
    expect(findWikiLinkAtPosition(markdown, markdown.indexOf("renamed"))).toMatchObject({
      target: "01J22222222222222222222222",
      targetId: "01J22222222222222222222222",
      display: "renamed"
    });
    expect(findWikiLinkAtPosition(markdown, 1)).toBeUndefined();
  });

  it("applies invisible Markdown decorations only outside the active line", () => {
    const markdown = "# Title\n\nThis is **bold** and [[Target|label]].\nActive **line**.";
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: markdown,
        selection: { anchor: markdown.length },
        extensions: [createInvisibleMarkdownExtension()]
      })
    });

    const hiddenMarkers = Array.from(host.querySelectorAll(".cm-slate-hidden-marker")).map(
      (element) => element.textContent
    );

    expect(hiddenMarkers).toEqual(["#", "**", "**", "[[", "|", "]]"]);

    view.destroy();
    host.remove();
  });
});
