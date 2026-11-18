import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import {
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { afterEach, expect, it, vi } from "vitest";
import { createSlateMarkdownExtensions } from "../src/index";
import {
  createMarkdownCompletions,
  markdownCompletionSource,
  type MarkdownCompletionOptions,
} from "../src/markdownCompletions";

const sheets = [
  { id: "home", path: "Home/Alpha.md", title: "Shared" },
  { id: "work", path: "Work/Alpha.md", title: "Shared" },
  { id: "accent", path: "Café.md", title: "Café" },
];
const tags = ["work", "work/project", "home", "invalid//tag", "x]", "work"];
const views: EditorView[] = [];
const settings = new Compartment();
function editor(
  doc: string,
  options: MarkdownCompletionOptions = { sheets, tags },
  head = doc.length,
) {
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc,
      selection: { anchor: head },
      extensions: [
        createSlateMarkdownExtensions(),
        settings.of(createMarkdownCompletions(options)),
      ],
    }),
  });
  views.push(view);
  return view;
}
function result(view: EditorView): CompletionResult | null {
  return markdownCompletionSource(
    new CompletionContext(
      view.state,
      view.state.selection.main.head,
      false,
      view,
    ),
  );
}
function pick(view: EditorView, index = 0) {
  const found = result(view)!;
  const option = found.options[index]!;
  if (typeof option.apply !== "function")
    throw new Error("Expected atomic completion");
  option.apply(view, option, found.from, found.to!);
}

it("opens a date picker without changing the query or undo history", () => {
  const onPickDate = vi.fn();
  const view = editor("Words @date", { sheets, tags, onPickDate });
  expect(result(view)?.options[0]?.label).toBe("Choose date…");
  pick(view);
  expect(onPickDate).toHaveBeenCalledExactlyOnceWith(view);
  expect(view.state.doc.toString()).toBe("Words @date");
  expect(undo(view)).toBe(false);
});

it("keeps a disabled or stale date option inert independently of wiki/tag rules", () => {
  const onPickDate = vi.fn();
  expect(
    result(editor("@", { sheets, tags, date: false, onPickDate })),
  ).toBeNull();
  const view = editor("@", {
    sheets,
    tags,
    wiki: false,
    tag: false,
    onPickDate,
  });
  const found = result(view)!;
  const option = found.options[0]!;
  expect(option.label).toBe("Choose date…");
  view.dispatch({
    effects: settings.reconfigure(
      createMarkdownCompletions({ date: false, onPickDate }),
    ),
  });
  if (typeof option.apply !== "function")
    throw new Error("Expected a guarded picker");
  option.apply(view, option, found.from, found.to!);
  expect(onPickDate).not.toHaveBeenCalled();
  expect(view.state.doc.toString()).toBe("@");
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const view of views.splice(0)) {
    const host = view.dom.parentElement;
    view.destroy();
    host?.remove();
  }
});

it("accepts an unchanged target after unrelated tag metadata refreshes", () => {
  const view = editor("#wor");
  const found = result(view)!;
  const option = found.options.find(
    (option) => option.label === "work/project",
  )!;
  if (typeof option.apply !== "function")
    throw new Error("Expected atomic completion");
  view.dispatch({
    effects: settings.reconfigure(
      createMarkdownCompletions({ sheets, tags: [...tags, "wor"] }),
    ),
  });
  option.apply(view, option, found.from, found.to!);
  expect(view.state.doc.toString()).toBe("#work/project");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("#wor");
});

it("leaves IME composition untouched even if an old completion is picked", () => {
  const view = editor("[[sha");
  const found = result(view)!;
  const option = found.options[0]!;
  vi.spyOn(view, "compositionStarted", "get").mockReturnValue(true);
  expect(result(view)).toBeNull();
  if (typeof option.apply !== "function")
    throw new Error("Expected atomic completion");
  option.apply(view, option, found.from, found.to!);
  expect(view.state.doc.toString()).toBe("[[sha");
  expect(undo(view)).toBe(false);
});

it("rejects a no-longer-matching suggestion during the typing delay", () => {
  const view = editor("[[sha");
  const found = result(view)!;
  const option = found.options[0]!;
  if (typeof option.apply !== "function")
    throw new Error("Expected atomic completion");
  view.dispatch({
    changes: { from: 2, to: 5, insert: "other" },
    selection: { anchor: 7 },
  });
  option.apply(view, option, 2, 7);
  expect(view.state.doc.toString()).toBe("[[other");
});

it("shows equal titles with distinct paths and searches title, path and accents", () => {
  expect(
    result(editor("[[shared"))?.options.map((option) => [
      option.label,
      option.detail,
    ]),
  ).toEqual([
    ["Shared", "Home/Alpha.md"],
    ["Shared", "Work/Alpha.md"],
  ]);
  expect(
    result(editor("[[work/"))?.options.map((option) => option.detail),
  ).toEqual(["Work/Alpha.md"]);
  expect(
    result(editor("[[cafe"))?.options.map((option) => option.label),
  ).toEqual(["Café"]);
});

it.each(["[[sha", "[[sha]]"])(
  "inserts a canonical wiki link atomically in %s, consuming existing closers",
  (doc) => {
    const head = doc.indexOf("]") < 0 ? doc.length : doc.indexOf("]");
    const view = editor(doc, { sheets, tags }, head);
    pick(view, 1);
    const expected = "[[Work/Alpha.md|Shared]]";
    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.selection.main.head).toBe(expected.length);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.main.head).toBe(head);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
  },
);

it("keeps preceding typing separate from accepting a completion", () => {
  const view = editor("Before ");
  view.dispatch({
    changes: { from: 7, insert: "[[sha" },
    selection: { anchor: 12 },
    annotations: Transaction.userEvent.of("input.type"),
  });
  pick(view);
  expect(view.state.doc.toString()).toBe("Before [[Home/Alpha.md|Shared]]");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Before [[sha");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Before ");
});

it("offers unique valid nested tags and preserves adjacent punctuation", () => {
  const view = editor("Words (#wo).", { sheets, tags }, 10);
  expect(result(view)?.options.map((option) => option.label)).toEqual([
    "work",
    "work/project",
  ]);
  pick(view, 1);
  expect(view.state.doc.toString()).toBe("Words (#work/project).");
  expect(view.state.selection.main.head).toBe(20);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Words (#wo).");
});

it.each([
  "`[[sha`",
  "```md\n#wo\n```",
  "---\n#wo\n---",
  "https://example.com/#wo",
  "mail@date",
  "<!-- [[sha -->",
  "@today",
  "ordinary text",
])("keeps excluded input literal: %s", (doc) => {
  const end =
    doc.indexOf("\n#wo") >= 0
      ? doc.indexOf("#wo") + 3
      : doc.indexOf("[[sha") >= 0
        ? doc.indexOf("[[sha") + 5
        : doc.length;
  expect(result(editor(doc, { sheets, tags }, end))).toBeNull();
});

it("independently disables wiki and tag suggestions", () => {
  expect(result(editor("[[sha", { sheets, tags, wiki: false }))).toBeNull();
  expect(result(editor("#wo", { sheets, tags, tag: false }))).toBeNull();
  expect(
    result(editor("[[sha", { sheets, tags, tag: false }))?.options,
  ).toHaveLength(2);
  expect(
    result(editor("#wo", { sheets, tags, wiki: false }))?.options,
  ).toHaveLength(2);
});

it("rejects stale selections, read-only or composing views and removed targets", () => {
  const view = editor("[[sha");
  const found = result(view)!;
  const option = found.options[0]!;
  if (typeof option.apply !== "function")
    throw new Error("Expected atomic completion");
  const apply = () =>
    option.apply instanceof Function &&
    option.apply(view, option, found.from, found.to!);
  view.dispatch({ selection: { anchor: 0, head: 5 } });
  apply();
  expect(view.state.doc.toString()).toBe("[[sha");
  view.dispatch({
    selection: { anchor: 5 },
    effects: settings.reconfigure(
      createMarkdownCompletions({ sheets: [], tags }),
    ),
  });
  apply();
  expect(view.state.doc.toString()).toBe("[[sha");
  view.dispatch({
    effects: settings.reconfigure([
      createMarkdownCompletions({ sheets, tags }),
      EditorState.readOnly.of(true),
    ]),
  });
  expect(result(view)).toBeNull();
  apply();
  expect(view.state.doc.toString()).toBe("[[sha");
});
