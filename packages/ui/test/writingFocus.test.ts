import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { Transaction } from "@codemirror/state";
import { createDocumentSession, editorSource } from "@slate/editor";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { MarkdownEditor } from "../src/MarkdownEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: { root: Root; host: HTMLElement }[] = [];
const descriptors = new Map(["getClientRects", "getBoundingClientRect"].map(name => [name, Object.getOwnPropertyDescriptor(Range.prototype, name)]));
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
});
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); }
  localStorage.clear();
});
afterAll(() => {
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor); else Reflect.deleteProperty(Range.prototype, name);
  }
});
async function mount(source: string) {
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host), session = createDocumentSession(source);
  mounted.push({ root, host });
  async function render(writingFocus: "none" | "paragraph" | "sentence", readOnly = false, typewriter = false) {
    const props = { documentSession: session, documentKey: "writing-focus/note.md", viewKey: "writing-focus/note.md", writingFocus, readOnly, typewriter };
    await act(async () => root.render(createElement(MarkdownEditor, props)));
  }
  await render("none");
  const view = () => EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-content")!)!;
  const line = (text: string) => Array.from(host.querySelectorAll<HTMLElement>(".cm-line")).find(element => element.textContent === text)!;
  return { session, host, render, view, line };
}

it("focuses a complete Markdown paragraph across physical lines and follows the caret", async () => {
  const source = "\uFEFFFirst thought.\r\nThe same paragraph keeps going.\r\n\r\nAnother paragraph stays here.\r\n";
  const { session, render, view, line } = await mount(source), editor = view();
  await act(async () => editor.dispatch({ selection: { anchor: 3 } })); await render("paragraph");
  expect(line("Another paragraph stays here.").classList.contains("cm-writing-dim")).toBe(true);
  expect(line("The same paragraph keeps going.").classList.contains("cm-writing-dim")).toBe(false);
  await act(async () => editor.dispatch({ selection: { anchor: editor.state.doc.toString().indexOf("Another") + 3 } }));
  expect(line("The same paragraph keeps going.").classList.contains("cm-writing-dim")).toBe(true);
  expect(line("Another paragraph stays here.").classList.contains("cm-writing-dim")).toBe(false);
  expect(view()).toBe(editor); expect(editorSource(editor.state)).toBe(source); expect(session.snapshot().revision).toBe(0);
});

it("dims other sentences on the same physical line, including Unicode text, without changing Read source", async () => {
  const source = "One sentence. Another thought stays here! 最後の文。";
  const { session, host, render, view } = await mount(source), editor = view();
  await act(async () => editor.dispatch({ selection: { anchor: source.indexOf("thought") } }));
  await render("sentence", true);
  const dimmed = Array.from(host.querySelectorAll(".cm-writing-dim")).map(element => element.textContent).join("");
  expect(dimmed).toBe("One sentence. 最後の文。");
  expect(editor.state.readOnly).toBe(true); expect(session.canEdit()).toBe(true);
  expect(editorSource(editor.state)).toBe(source); expect(session.snapshot().revision).toBe(0);
});

it("reconfigures writing modes without replacing the view, selection, exact source or shared Undo", async () => {
  const source = "\uFEFF# Heading\r\n\r\nWords kept.\r\n", { session, render, view } = await mount(source), editor = view();
  await act(async () => editor.dispatch({ changes: { from: editor.state.doc.length, insert: "New words" },
    selection: { anchor: editor.state.doc.length + 9 }, annotations: Transaction.userEvent.of("input.type") }));
  const selection = editor.state.selection.main.head;
  await render("paragraph", false, true); expect(editor.dom.classList.contains("cm-writing-typewriter")).toBe(true);
  await render("sentence"); expect(view()).toBe(editor); expect(editor.state.selection.main.head).toBe(selection);
  expect(editorSource(editor.state)).toBe(source + "New words");
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  await act(async () => { expect(runScopeHandlers(editor, new KeyboardEvent("keydown", { key: "z", ctrlKey: !mac, metaKey: mac }), "editor")).toBe(true); });
  expect(session.snapshot().source).toBe(source);
  await render("none"); expect(editor.dom.classList.contains("cm-writing-typewriter")).toBe(false);
});
