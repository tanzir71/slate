import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forceParsing } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import { afterEach, expect, it, vi } from "vitest";
import { createSlateMarkdownExtensions, livePreviewSettings } from "../src/index";

const views: EditorView[] = [], appearance = new Compartment();
function editor(source: string, readOnly = false) {
  const doc = source + "\n\nActive";
  const view = new EditorView({ parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ doc, selection: { anchor: doc.length },
      extensions: [createSlateMarkdownExtensions(), EditorState.readOnly.of(readOnly), appearance.of([])] }) });
  views.push(view);
  expect(forceParsing(view, view.state.doc.length, 1_000)).toBe(true);
  return view;
}
afterEach(() => {
  for (const view of views.splice(0)) { const parent = view.dom.parentElement; view.destroy(); parent?.remove(); }
  vi.unstubAllGlobals();
});

it.each(["```js\nconst count = 1;\n```", "~~~python\nprint('Hello')\n~~~", "```unknown-language\n<safe> & literal\n```", "```\nplain\n```", "```js\n```"])("previews a fenced block without editing its source: %j", source => {
  const view = editor(source), original = view.state.doc;
  expect(view.dom.querySelector(".cm-slate-code-block")).not.toBeNull();
  expect(view.dom.querySelector(".cm-slate-code-header")).not.toBeNull();
  expect(view.dom.querySelector(".cm-slate-code-language")?.textContent).toBe(source.split("\n")[0]!.slice(3) || "Plain text");
  expect(view.dom.querySelector(".cm-slate-code-copy")?.textContent).toBe("Copy");
  expect(view.state.doc).toBe(original);
  expect(undo(view)).toBe(false);
});

it("reveals only the fence line holding a caret and keeps the code editable", () => {
  const source = "```js\nconst count = 1;\n```", view = editor(source), original = view.state.doc;
  view.dispatch({ selection: { anchor: source.indexOf("count") } });
  expect(view.dom.querySelector(".cm-slate-code-header")).not.toBeNull();
  view.dispatch({ selection: { anchor: 3 } });
  expect(view.dom.querySelector(".cm-slate-code-header")).toBeNull();
  expect(view.dom.querySelector(".cm-slate-code-opening")?.textContent).toBe("```js");
  view.dispatch({ selection: { anchor: source.length } });
  expect(view.dom.querySelector(".cm-slate-code-closing")?.textContent).toBe("```");
  view.dispatch({ selection: { anchor: original.length } });
  expect(view.dom.querySelector(".cm-slate-code-header")).not.toBeNull();
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it.each([false, true])("copies only the code, including blank lines, without changing selection or undo (readOnly %s)", async readOnly => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const view = editor("```js\nconst count = 1;\n\n  keepIndent();\n```", readOnly), original = view.state.doc, selection = view.state.selection;
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-slate-code-copy");
  expect(button).not.toBeNull(); button!.click();
  await vi.waitFor(() => expect(button!.textContent).toBe("Copied"));
  expect(writeText).toHaveBeenCalledExactlyOnceWith("const count = 1;\n\n  keepIndent();\n");
  expect(view.state.selection).toBe(selection); expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it("reports denied clipboard access and ignores detached headers", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const view = editor("```js\nkept\n```"), button = view.dom.querySelector<HTMLButtonElement>(".cm-slate-code-copy");
  expect(button).not.toBeNull(); button!.click();
  await vi.waitFor(() => expect(button!.textContent).toBe("Copy failed"));
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Replacement" }, selection: { anchor: 0 } });
  button!.click(); expect(writeText).toHaveBeenCalledTimes(1);
  expect(view.state.doc.toString()).toBe("Replacement");
});

it("keeps Source mode and visible syntax literal, and restores preview without an edit", () => {
  const view = editor("```js\nconst count = 1;\n```"), original = view.state.doc;
  for (const settings of [{ hideSyntax: true, highContrastMarkers: false, sourceMode: true }, { hideSyntax: false, highContrastMarkers: true }]) {
    view.dispatch({ effects: appearance.reconfigure(livePreviewSettings.of(settings)) });
    expect(view.dom.querySelector(".cm-slate-code-header")).toBeNull();
    expect(view.contentDOM.textContent).toContain("```js");
  }
  view.dispatch({ effects: appearance.reconfigure([]) });
  expect(view.dom.querySelector(".cm-slate-code-header")).not.toBeNull();
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it("does not interpret inline code or indented code as a fenced block", () => {
  const view = editor("`inline`\n\n    indented");
  expect(view.dom.querySelector(".cm-slate-code-block")).toBeNull();
});

it("keeps nested callout source literal while its fence is active", () => {
  const view = editor("> [!NOTE]\n> ```js\n> const count = 1;\n> ```"), original = view.state.doc;
  expect(view.dom.querySelector(".cm-slate-code-header")).not.toBeNull();
  expect(view.dom.querySelectorAll(".cm-slate-callout-container")).toHaveLength(1);
  expect(view.dom.querySelector(".cm-slate-callout-container > .cm-slate-code-block")).not.toBeNull();
  view.dispatch({ selection: { anchor: original.toString().indexOf("count") } });
  expect(view.dom.querySelector(".cm-slate-code-header")).toBeNull();
  expect(view.state.doc).toBe(original);
});

it.each(["js", "javascript", "python", "rust"])("loads actual %s syntax highlighting without rewriting the document", async language => {
  const body = language === "python" ? "def greet():\n  return 'Hello'" : language === "rust" ? "fn main() { let count = 1; }" : "const count = 1;";
  const view = editor(`\`\`\`${language}\n${body}\n\`\`\``), original = view.state.doc;
  await vi.waitFor(() => {
    forceParsing(view, view.state.doc.length, 1_000);
    expect(view.dom.querySelector(".cm-slate-code-line .tok-keyword")).not.toBeNull();
  }, { timeout: 5_000 });
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it.each(["> ```js\n> first\n> \n>   third\n> ```", "- ```js\n  first\n\n    third\n  ```"])("copies nested code without its container markers: %j", async source => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const view = editor(source), button = view.dom.querySelector<HTMLButtonElement>(".cm-slate-code-copy");
  expect(button).not.toBeNull(); button!.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("first\n\n  third\n"));
});

it("navigates to the fence through its language label, including in a read-only document", () => {
  const view = editor("```python\nprint('Hello')\n```", true), original = view.state.doc;
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-slate-code-language");
  expect(button).not.toBeNull(); button!.click();
  expect(view.state.selection.main.head).toBe(3);
  expect(view.dom.querySelector(".cm-slate-code-header")).toBeNull();
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it.each(["", "\n", "\n\n", "a\n\n", "  \n", "first\n\n\n"])("copies the exact empty and trailing body lines: %j", async body => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const view = editor(`\`\`\`\n${body}\`\`\``), button = view.dom.querySelector<HTMLButtonElement>(".cm-slate-code-copy");
  expect(button).not.toBeNull(); button!.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(body));
});
