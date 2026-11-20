import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forceParsing } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import { afterEach, expect, it } from "vitest";
import { createSlateMarkdownExtensions, livePreviewSettings } from "../src/index";

const views: EditorView[] = [];
const appearance = new Compartment();
function editor(source: string, readOnly = false) {
  const doc = source + "\n\nActive";
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc, selection: { anchor: doc.length },
      extensions: [createSlateMarkdownExtensions(), EditorState.readOnly.of(readOnly), appearance.of([])],
    }),
  });
  views.push(view);
  expect(forceParsing(view, view.state.doc.length, 1_000)).toBe(true);
  return view;
}
afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy(); parent?.remove();
  }
});

it.each(["NOTE", "TIP", "WARNING", "IMPORTANT", "CAUTION"])("renders a %s callout with its default title and original body", kind => {
  const source = `> [!${kind}]\n> Words worth keeping.`;
  const view = editor(source), original = view.state.doc;
  expect(view.dom.querySelector(".cm-slate-callout-title")?.textContent).toBe(kind[0] + kind.slice(1).toLowerCase());
  expect(view.dom.querySelector(".cm-slate-callout-body")?.textContent).toBe("Words worth keeping.");
  expect(view.state.doc).toBe(original);
  expect(view.state.doc.toString()).toBe(source + "\n\nActive");
  expect(undo(view)).toBe(false);
});

it("retains inline Markdown in a custom callout title and body", () => {
  const view = editor("> [!tip] Keep **the core** free\n> Body with *emphasis* and [[Target|alias]].");
  expect(view.dom.querySelector(".cm-slate-callout-title")?.textContent).toBe("Keep the core free");
  expect(view.dom.querySelector(".cm-slate-callout-title .cm-slate-strong")?.textContent).toBe("the core");
  expect(view.dom.querySelector(".cm-slate-callout-body .cm-slate-emphasis")?.textContent).toBe("emphasis");
  expect(view.dom.querySelector(".cm-slate-callout-body .cm-slate-wiki-link")?.textContent).toBe("alias");
});

it("shows the whole callout source while editing it and restores its card without an undo entry", () => {
  const source = "> [!TIP] Custom\n> Body", view = editor(source), original = view.state.doc;
  expect(view.dom.querySelector(".cm-slate-callout-title")).not.toBeNull();
  view.dispatch({ selection: { anchor: source.indexOf("Body") + 2 } });
  expect(view.dom.querySelector(".cm-slate-callout-title")).toBeNull();
  expect(view.contentDOM.textContent).toContain("> [!TIP] Custom");
  view.dispatch({ selection: { anchor: original.length } });
  expect(view.dom.querySelector(".cm-slate-callout-title")?.textContent).toBe("Custom");
  expect(view.state.doc).toBe(original);
  expect(undo(view)).toBe(false);
});

it("keeps Source mode literal and switches back without changing the document", () => {
  const view = editor("> [!NOTE]\n> Body"), original = view.state.doc;
  expect(view.dom.querySelector(".cm-slate-callout-title")).not.toBeNull();
  view.dispatch({ effects: appearance.reconfigure(livePreviewSettings.of({ hideSyntax: true, highContrastMarkers: false, sourceMode: true })) });
  expect(view.dom.querySelector(".cm-slate-callout-title")).toBeNull();
  expect(view.contentDOM.textContent).toContain("> [!NOTE]");
  view.dispatch({ effects: appearance.reconfigure([]) });
  expect(view.dom.querySelector(".cm-slate-callout-title")?.textContent).toBe("Note");
  expect(view.state.doc).toBe(original);
  expect(undo(view)).toBe(false);
});

it("honors the visible-syntax setting for the entire callout", () => {
  const view = editor("> [!TIP]\n> **Body**"), original = view.state.doc;
  view.dispatch({ effects: appearance.reconfigure(livePreviewSettings.of({ hideSyntax: false, highContrastMarkers: true })) });
  expect(view.dom.querySelector(".cm-slate-callout-title")).toBeNull();
  expect(view.contentDOM.textContent).toContain("> [!TIP]");
  expect(view.contentDOM.textContent).toContain("> **Body**");
  expect(view.state.doc).toBe(original);
});

it("keeps a header-only callout as one complete card", () => {
  const view = editor("> [!NOTE]");
  expect(view.dom.querySelector(".cm-slate-callout-title.cm-slate-callout-end")?.textContent).toBe("Note");
  expect(view.dom.querySelector(".cm-slate-callout-body")).toBeNull();
});

it("ignores a detached callout label after its source has been replaced", () => {
  const view = editor("> [!NOTE]\n> Body"), label = view.dom.querySelector(".cm-slate-callout-label")!;
  expect(label).not.toBeNull();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "X" }, selection: { anchor: 1 } });
  label.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  expect(view.state.selection.main.head).toBe(1);
  expect(view.state.doc.toString()).toBe("X");
});

it.each([
  "```md\n> [!TIP]\n> Body\n```", ">     [!TIP]\n>     Body", "> [!UNKNOWN]\n> Body",
  "> [!TIP]literal\n> Body", "> Words\n> [!TIP]\n> Body", "Words [!TIP]", "> [!TIP\n> Body",
])("keeps non-callout syntax literal: %j", source => {
  const view = editor(source);
  expect(view.dom.querySelector(".cm-slate-callout-title")).toBeNull();
  expect(view.state.doc.toString()).toBe(source + "\n\nActive");
});

it("keeps neighboring callouts separate", () => {
  const view = editor("> [!NOTE] First\n> One\n\n> [!TIP] Second\n> Two");
  expect(Array.from(view.dom.querySelectorAll(".cm-slate-callout-title"), node => node.textContent)).toEqual(["First", "Second"]);
  expect(Array.from(view.dom.querySelectorAll(".cm-slate-callout-body"), node => node.textContent)).toEqual(["One", "Two"]);
});

it.each([
  ["[missing]", "[missing]"],
  ["[label][missing]", "[label][missing]"],
  ["> [!UNKNOWN]\n> Body", "[!UNKNOWN]"],
])("preserves unresolved reference syntax in %j", (source, literal) => {
  const view = editor(source);
  expect(view.contentDOM.textContent).toContain(literal);
  expect(view.dom.querySelector(".cm-slate-link")).toBeNull();
});

it("still renders a reference label when its destination exists", () => {
  const view = editor("[known]\n\n[known]: https://example.test");
  expect(view.dom.querySelector(".cm-slate-link")?.textContent).toBe("known");
  expect(view.dom.querySelector(".cm-slate-link")?.getAttribute("data-slate-href")).toBe("https://example.test");
});

it.each([false, true])("opens the actual header source from its callout icon without editing (readOnly %s)", readOnly => {
  const view = editor("> [!NOTE]\n> Body", readOnly), original = view.state.doc;
  const label = view.dom.querySelector(".cm-slate-callout-label");
  expect(label).not.toBeNull();
  label!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  expect(view.state.selection.main.head).toBe(2);
  expect(view.dom.querySelector(".cm-slate-callout-title")).toBeNull();
  expect(view.state.doc).toBe(original);
  expect(undo(view)).toBe(false);
});
