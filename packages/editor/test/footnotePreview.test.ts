import { EditorState, Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forceParsing } from "@codemirror/language";
import * as language from "@codemirror/language";
import { undo } from "@codemirror/commands";
import { afterEach, expect, it, vi } from "vitest";
import { createSlateMarkdownExtensions, knownWikiTargets, livePreviewSettings } from "../src/index";

vi.mock("@codemirror/language", async importOriginal => {
  const actual = await importOriginal<typeof import("@codemirror/language")>();
  return { ...actual, ensureSyntaxTree: vi.fn(actual.ensureSyntaxTree) };
});

const mounted: EditorView[] = [];
function editor(source: string, readOnly = false) {
  const parent = document.body.appendChild(document.createElement("div"));
  const doc = source + "\n\nActive.";
  const mode = new Compartment();
  const view = new EditorView({ parent, state: EditorState.create({ doc, selection: { anchor: doc.length },
    extensions: [createSlateMarkdownExtensions(), EditorState.readOnly.of(readOnly), mode.of([])] }) });
  mounted.push(view); expect(forceParsing(view, view.state.doc.length, 1000)).toBe(true);
  return { view, mode, doc };
}
function references(view: EditorView) { return [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-slate-footnote-reference")]; }
function preview(button: HTMLButtonElement) {
  button.dispatchEvent(new MouseEvent("mouseenter"));
  return button.parentElement!.querySelector<HTMLElement>("[role=tooltip]")!;
}
afterEach(() => { vi.useRealTimers(); for (const view of mounted.splice(0)) { const parent = view.dom.parentElement; view.destroy(); parent?.remove(); } });

it("shows superscript references and safe hover text without changing the document or Undo", () => {
  const { view, doc } = editor("A claim[^note].\n\n[^note]: A **strong** note with `code` and [a link](https://note.invalid).");
  const [button] = references(view); expect(button?.textContent).toBe("note");
  expect(button?.getAttribute("aria-label")).toBe("Footnote note");
  const tooltip = preview(button!); expect(tooltip.hidden).toBe(false);
  expect(tooltip.textContent).toBe("A strong note with code and a link.");
  expect(tooltip.querySelector("a, script, img")).toBeNull();
  expect(button!.getAttribute("aria-describedby")).toBe(tooltip.id);
  expect(view.state.doc.toString()).toBe(doc); expect(undo(view)).toBe(false);
});

it("matches normalized Unicode labels and uses the first definition", () => {
  const { view } = editor("One[^CAFÉ] two[^café] three[^missing].\n\n[^café]: First note.\n\n[^CAFÉ]: Later duplicate.");
  const buttons = references(view); expect(buttons).toHaveLength(3);
  expect(preview(buttons[0]!).textContent).toBe("First note.");
  expect(preview(buttons[1]!).textContent).toBe("First note.");
  expect(preview(buttons[2]!).textContent).toBe("Footnote definition not found.");
});

it("supports continuation paragraphs, nested code and blank lines", () => {
  const { view } = editor("Claim[^a].\n\n[^a]: First paragraph.\n    A soft continuation.\n\n    Second **paragraph**.\n\n        literal <script>\n        keep indent");
  expect(preview(references(view)[0]!).textContent).toBe("First paragraph.\nA soft continuation.\n\nSecond paragraph.\n\nliteral <script>\nkeep indent");
});

it("resolves definitions nested in blockquotes and lists", () => {
  const { view } = editor("Claim[^quote] and[^list].\n\n> [^quote]: Quoted note.\n>     Continued note.\n\n- [^list]: Listed note.\n      Next line.");
  const buttons = references(view); expect(buttons).toHaveLength(2);
  expect(preview(buttons[0]!).textContent).toBe("Quoted note.\nContinued note.");
  expect(preview(buttons[1]!).textContent).toBe("Listed note.\nNext line.");
});

it("keeps escaped syntax, code, HTML, image alt and YAML out of footnote widgets and definitions", async () => {
  const { view } = editor("---\ntitle: '[^meta]'\n---\n\n\\[^escaped] `[^inline]`\n\n```md\n[^fence]\n[^a]: Wrong code note.\n```\n\n    [^indent]\n\n<div>\n[^html]\n</div>\n\n![alt[^image]](x.png)\n\nClaim[^a].\n\n[^a]: Correct note.");
  const buttons = references(view); expect(buttons).toHaveLength(1);
  vi.mocked(language.ensureSyntaxTree).mockReturnValueOnce(null);
  const tooltip = preview(buttons[0]!);
  expect(tooltip.textContent).toBe("Loading footnote…");
  await vi.waitFor(() => expect(tooltip.textContent).toBe("Correct note."));
});

it("does not execute HTML, fetch remote images or create links in previews", () => {
  const { view } = editor("Claim[^a].\n\n[^a]: <img src='https://note.invalid/pixel' onerror='alert(1)'> ![caption](https://note.invalid/image.png) [bad](javascript:alert(1))");
  const tooltip = preview(references(view)[0]!);
  expect(tooltip.textContent).toContain("caption"); expect(tooltip.textContent).toContain("bad");
  expect(tooltip.querySelector("img, a, iframe, script")).toBeNull();
  expect(view.dom.querySelectorAll(".cm-slate-footnote-reference")).toHaveLength(1);
});

it("reveals source on every selected line and retains shared Undo", () => {
  const { view, doc } = editor("One[^a].\nTwo[^a].\n\n[^a]: Note.");
  expect(references(view)).toHaveLength(2);
  view.dispatch({ selection: { anchor: 1 } }); expect(references(view)).toHaveLength(1);
  expect(view.dom.textContent).toContain("One[^a].");
  view.dispatch({ selection: { anchor: 1, head: doc.indexOf("Two") + 2 } }); expect(references(view)).toHaveLength(0);
  view.dispatch({ selection: { anchor: doc.length } }); expect(references(view)).toHaveLength(2);
  expect(view.state.doc.toString()).toBe(doc); expect(undo(view)).toBe(false);
});

it("clicking or tapping a reference opens its note without moving selection or changing Undo", () => {
  const { view, doc } = editor("Claim[^a].\n\n[^a]: Note.");
  const button = references(view)[0]!; button.click();
  expect(view.state.selection.main.anchor).toBe(doc.length);
  expect(button.parentElement!.querySelector<HTMLElement>("[role=tooltip]")?.hidden).toBe(false);
  expect(view.state.doc.toString()).toBe(doc); expect(undo(view)).toBe(false);
});

it("supports keyboard focus and Escape and closes previews on blur, leave and scroll", () => {
  const { view } = editor("Claim[^a].\n\n[^a]: Note."); const button = references(view)[0]!;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  button.focus(); const tooltip = button.parentElement!.querySelector<HTMLElement>("[role=tooltip]")!;
  expect(tooltip.hidden).toBe(false);
  button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); expect(tooltip.hidden).toBe(true);
  button.blur(); preview(button); expect(tooltip.hidden).toBe(false);
  button.parentElement!.dispatchEvent(new MouseEvent("mouseleave")); vi.advanceTimersByTime(200); expect(tooltip.hidden).toBe(true);
  preview(button); view.scrollDOM.dispatchEvent(new Event("scroll", { bubbles: false })); expect(tooltip.hidden).toBe(true);
  button.focus(); expect(tooltip.hidden).toBe(false); button.blur(); expect(tooltip.hidden).toBe(true);
});

it("keeps a hover preview open when the pointer enters its text", () => {
  const { view } = editor("Claim[^a].\n\n[^a]: Hoverable note."); const button = references(view)[0]!, tooltip = preview(button);
  button.dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: tooltip })); expect(tooltip.hidden).toBe(false);
});

it("updates edited definitions and Undo, and ignores detached references", () => {
  const { view, doc } = editor("Claim[^a].\n\n[^a]: Original note."); const stale = references(view)[0]!;
  expect(preview(stale).textContent).toBe("Original note.");
  const from = doc.indexOf("Original"); view.dispatch({ changes: { from, to: from + 8, insert: "Updated" } });
  expect(stale.parentElement!.querySelector<HTMLElement>("[role=tooltip]")!.hidden).toBe(true);
  expect(preview(references(view)[0]!).textContent).toBe("Updated note.");
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(doc);
  expect(preview(references(view)[0]!).textContent).toBe("Original note.");
  view.dispatch({ selection: { anchor: 1 } }); view.dispatch({ selection: { anchor: doc.length } });
  expect(stale.isConnected).toBe(false); stale.click(); expect(view.state.selection.main.anchor).toBe(doc.length);
});

it.each([false, true])("keeps Live/Source settings reversible in read-only=%s", readOnly => {
  const { view, mode, doc } = editor("Claim[^a].\n\n[^a]: Note.", readOnly);
  expect(preview(references(view)[0]!).textContent).toBe("Note.");
  view.dispatch({ effects: mode.reconfigure(livePreviewSettings.of({ hideSyntax: false, highContrastMarkers: true })) });
  expect(references(view)).toHaveLength(0); expect(view.dom.textContent).toContain("Claim[^a].");
  view.dispatch({ effects: mode.reconfigure([]) }); expect(references(view)).toHaveLength(1);
  expect(view.state.doc.toString()).toBe(doc); expect(undo(view)).toBe(false);
});

it("retains ordinary link references and malformed or overlong footnote source", () => {
  const { view } = editor("[site][ref] [^] [^two words] [^" + "x".repeat(1000) + "]\n\n[ref]: https://example.com\n\n[^a]: One.");
  expect(references(view)).toHaveLength(0); expect(view.dom.querySelector(".cm-slate-link")?.textContent).toBe("site");
});

it("supports escaped label punctuation and handles empty notes", () => {
  const { view } = editor("Claim[^a\\]] and[^empty].\n\n[^a\\]]: Escaped label.\n\n[^empty]:\n");
  const buttons = references(view); expect(buttons.map(button => button.textContent)).toEqual(["a]", "empty"]);
  expect(preview(buttons[0]!).textContent).toBe("Escaped label.");
  expect(preview(buttons[1]!).textContent).toBe("Empty footnote.");
});

it("closes on outside interaction and disposes active previews with their editor", () => {
  const { view } = editor("Claim[^a].\n\n[^a]: Note."); const button = references(view)[0]!, tooltip = preview(button);
  document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); expect(tooltip.hidden).toBe(true);
  preview(button); view.destroy(); expect(tooltip.hidden).toBe(true);
  mounted.splice(mounted.indexOf(view), 1); view.dom.parentElement?.remove();
});

it("matches shared Markdown semantics for adjacent definitions and definitions interrupting a paragraph", () => {
  const { view } = editor("Claim[^a] and[^b].\n[^a]: First.\n[^b]: Second."); const buttons = references(view);
  expect(preview(buttons[0]!).textContent).toBe("First."); expect(preview(buttons[1]!).textContent).toBe("Second.");
});

it("lets long previews scroll without closing the note", () => {
  const { view } = editor("Claim[^a].\n\n[^a]: First.\n\n    Second."); const tooltip = preview(references(view)[0]!);
  tooltip.dispatchEvent(new Event("scroll")); expect(tooltip.hidden).toBe(false);
  view.scrollDOM.dispatchEvent(new Event("scroll")); expect(tooltip.hidden).toBe(true);
});

it("does not render escaped whitespace or identifiers longer than999 raw characters", () => {
  const { view } = editor("Claim[^a\\ ] and[^" + "\\]".repeat(500) + "]."); expect(references(view)).toHaveLength(0);
});

it("retains backslashes before non-punctuation in displayed labels", () => {
  const { view } = editor("Claim[^a\\q].\n\n[^a\\q]: Note."); expect(references(view)[0]!.textContent).toBe("a\\q");
  expect(preview(references(view)[0]!).textContent).toBe("Note.");
});

it("keeps an open note visible through unrelated catalog reconfiguration", () => {
  const { view, doc } = editor("Claim[^a].\n\n[^a]: Note."); const tooltip = preview(references(view)[0]!);
  view.dispatch({ effects: StateEffect.appendConfig.of(knownWikiTargets.of(new Set(["newly indexed sheet"]))) });
  expect(tooltip.hidden).toBe(false); expect(tooltip.textContent).toBe("Note.");
  expect(view.state.doc.toString()).toBe(doc); expect(undo(view)).toBe(false);
});
