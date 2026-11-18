import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCommandKeymap, slateCommands } from "@slate/core";
import {
  createFormattingBindings,
  createSlateMarkdownExtensions,
  formattingCommandIds,
  runFormattingCommand,
} from "../src/index";

const views: EditorView[] = [];
function editor(doc: string, anchor = 0, head = doc.length, readOnly = false) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [
        createSlateMarkdownExtensions({ formattingKeys: false }),
        EditorState.readOnly.of(readOnly),
      ],
    }),
  });
  views.push(view);
  return view;
}
afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

describe("registered formatting commands", () => {
  it("formats a large selection with many inline code spans without losing source", () => {
    const doc = "`x` ".repeat(75_000);
    // This command only needs state/history; avoid parsing 150k syntax markers
    // into jsdom while testing the real command and its undo transaction.
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: 0, head: doc.length },
        extensions: history(),
      }),
    });
    views.push(view);
    expect(runFormattingCommand(view, "format.code")).toBe(true);
    expect(view.state.doc.toString()).toBe("`` " + doc + " ``");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });
  it("implements exactly the registered Format actions", () => {
    expect(formattingCommandIds.toSorted()).toEqual(
      slateCommands
        .filter((command) => command.group === "Format")
        .map((command) => command.id)
        .toSorted(),
    );
  });

  it.each([
    ["bold", "**words**"],
    ["italic", "*words*"],
    ["strike", "~~words~~"],
    ["highlight", "==words=="],
    ["code", "`words`"],
    ["comment", "<!-- words -->"],
    ["link", "[words](url)"],
    ["heading1", "# words"],
    ["heading6", "###### words"],
    ["ordered", "1. words"],
    ["bullet", "- words"],
    ["task", "- [ ] words"],
    ["quote", "> words"],
    ["codeblock", "```\nwords\n```"],
  ])("applies %s and restores the original with one undo", (id, expected) => {
    const view = editor("words");
    expect(runFormattingCommand(view, `format.${id}`)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("words");
  });

  it.each([
    "bold",
    "italic",
    "strike",
    "highlight",
    "code",
    "comment",
    "link",
    "heading2",
    "ordered",
    "bullet",
    "task",
    "quote",
    "codeblock",
  ])("toggles %s off without changing the selected words", (id) => {
    const view = editor("words");
    runFormattingCommand(view, `format.${id}`);
    runFormattingCommand(view, `format.${id}`);
    expect(view.state.doc.toString()).toBe("words");
  });

  it("isolates consecutive formatting operations and prior typing in history", () => {
    const view = editor("word");
    view.dispatch({
      changes: { from: 4, insert: "s" },
      selection: { anchor: 0, head: 5 },
      userEvent: "input.type",
    });
    runFormattingCommand(view, "format.bold");
    runFormattingCommand(view, "format.highlight");
    undo(view);
    expect(view.state.doc.toString()).toBe("**words**");
    undo(view);
    expect(view.state.doc.toString()).toBe("words");
    undo(view);
    expect(view.state.doc.toString()).toBe("word");
  });

  it("converts selected lines, preserves indentation and excludes the next line at its start", () => {
    const view = editor("  ## first\n  - [x] second\nthird", 0, 25);
    runFormattingCommand(view, "format.ordered");
    expect(view.state.doc.toString()).toBe("  1. first\n  2. second\nthird");
    runFormattingCommand(view, "format.paragraph");
    expect(view.state.doc.toString()).toBe("  first\n  second\nthird");
    const tasks = editor("- [x] first\nsecond");
    runFormattingCommand(tasks, "format.task");
    expect(tasks.state.doc.toString()).toBe("- [x] first\n- [ ] second");
  });

  it("uses longer code fences with padding and toggles them without losing backticks", () => {
    for (const text of ["`words", "words`", "a `` b", "words\n```\nmore"]) {
      const view = editor(text);
      const id = text.includes("\n") ? "format.codeblock" : "format.code";
      runFormattingCommand(view, id);
      expect(view.state.doc.toString()).toContain(text);
      runFormattingCommand(view, id);
      expect(view.state.doc.toString()).toBe(text);
    }
  });

  it("does not remove a bold delimiter when applying italic inside bold", () => {
    const view = editor("**words**", 2, 7);
    runFormattingCommand(view, "format.italic");
    expect(view.state.doc.toString()).toBe("***words***");
  });

  it("toggles a task without changing text, and refuses read-only or unavailable actions", () => {
    const task = editor("- [X] words");
    runFormattingCommand(task, "format.toggleTask");
    expect(task.state.doc.toString()).toBe("- [ ] words");
    expect(runFormattingCommand(editor("words"), "format.toggleTask")).toBe(
      false,
    );
    expect(runFormattingCommand(editor("words", 2, 2), "format.link")).toBe(
      false,
    );
    expect(runFormattingCommand(task, "missing")).toBe(false);
    const locked = editor("words", 0, 5, true);
    for (const id of formattingCommandIds)
      expect(runFormattingCommand(locked, id)).toBe(false);
    expect(locked.state.doc.toString()).toBe("words");
  });

  it("delivers a custom binding without consuming its old key or composing input", () => {
    const view = editor("words");
    const map = resolveCommandKeymap(
      { os: "windows", surface: "web" },
      { version: 1, bindings: { "format.bold": "Mod+Shift+b" } },
    );
    view.dispatch({
      effects: StateEffect.appendConfig.of(createFormattingBindings(map)),
    });
    view.focus();
    const send = (shiftKey: boolean, isComposing = false) =>
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          code: "KeyB",
          ctrlKey: true,
          shiftKey,
          isComposing,
          bubbles: true,
          cancelable: true,
        }),
      );
    expect(send(false)).toBe(true);
    expect(send(true, true)).toBe(true);
    expect(view.state.doc.toString()).toBe("words");
    expect(send(true)).toBe(false);
    expect(view.state.doc.toString()).toBe("**words**");
  });

  it("captures Android modified Enter while leaving composition and unmodified Enter alone", () => {
    const platform = vi
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue("Android Chrome");
    try {
      const view = editor("- [ ] words", 11, 11);
      const listen = vi.spyOn(view.contentDOM, "addEventListener");
      view.dispatch({
        effects: StateEffect.appendConfig.of(
          createFormattingBindings(
            resolveCommandKeymap({ os: "linux", surface: "web" }),
          ),
        ),
      });
      view.focus();
      const capture = listen.mock.calls.find(
        ([type, , options]) => type === "keydown" && options === true,
      )?.[1] as (event: KeyboardEvent) => void;
      expect(capture).toBeTypeOf("function");
      const composing = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      capture(composing);
      expect(composing.defaultPrevented).toBe(false);
      expect(view.state.doc.toString()).toBe("- [ ] words");
      const modified = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(modified);
      expect(modified.defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe("- [x] words");
      const plain = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      });
      capture(plain);
      expect(plain.defaultPrevented).toBe(false);
      view.contentDOM.dispatchEvent(plain);
      expect(view.state.doc.toString()).toContain("\n");
    } finally {
      platform.mockRestore();
    }
  });
});
