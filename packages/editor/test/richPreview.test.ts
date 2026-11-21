import { undo } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { createSlateMarkdownExtensions, livePreviewSettings } from "../src/index";
import { richPreviewRenderer } from "../src/richPreview";
import type { RichPreviewRenderer, RichPreviewRequest, RichPreviewResult } from "../src/richPreviewRenderer";

const views: EditorView[] = [], settings = new Compartment();
function editor(source: string, render = vi.fn(async (_request: RichPreviewRequest, _signal: AbortSignal): Promise<RichPreviewResult> => ({ html: "<math><mi>x</mi></math>" })), readOnly = false) {
  const doc = source + "\n\nActive", destroy = vi.fn(), create = vi.fn((): RichPreviewRenderer => ({ render, destroy }));
  const view = new EditorView({ parent: document.body.appendChild(document.createElement("div")), state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [createSlateMarkdownExtensions(), richPreviewRenderer.of(create), settings.of([]), EditorState.readOnly.of(readOnly)] }) });
  views.push(view); forceParsing(view, doc.length, 1_000); return { view, render, create, destroy };
}
const frame = (view: EditorView) => view.dom.querySelector<HTMLIFrameElement>(".cm-slate-rich-preview iframe");
afterEach(() => { for (const view of views.splice(0)) { const parent = view.dom.parentElement; view.destroy(); parent?.remove(); } document.documentElement.removeAttribute("data-theme"); });

it.each([false, true])("previews inline/display math and diagrams without changing source or Undo (readOnly %s)", async readOnly => {
  const source = "Inline $x_i$\n\n$$\nx^2\n\ny^2\n$$\n\n```mermaid\nflowchart LR\n A-->B\n```";
  const { view, render, create } = editor(source, undefined, readOnly), original = view.state.doc;
  await vi.waitFor(() => expect(view.dom.querySelectorAll(".cm-slate-rich-preview iframe")).toHaveLength(3));
  expect(create).toHaveBeenCalledTimes(1);
  expect(render.mock.calls.map(([request]) => ({ kind: request.kind, body: request.body, display: request.display }))).toEqual([
    { kind: "math", body: "x_i", display: false }, { kind: "math", body: "x^2\n\ny^2", display: true }, { kind: "diagram", body: "flowchart LR\n A-->B", display: true },
  ]);
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
  expect(frame(view)!.getAttribute("sandbox")).toBe("allow-same-origin");
  expect(frame(view)!.srcdoc).toContain("default-src 'none'");
  expect(view.dom.querySelector('iframe[title="Diagram preview"]')!.getAttribute("sandbox")).toBe("");
});

it("reveals the exact source immediately by activating its accessible control", async () => {
  const { view } = editor("Before $x+y$ after"), original = view.state.doc;
  await vi.waitFor(() => expect(frame(view)).not.toBeNull());
  view.dom.querySelector<HTMLButtonElement>('button[aria-label="Show math source"]')!.click();
  expect(frame(view)).toBeNull(); expect(view.state.selection.main.head).toBe(8);
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it("aborts hidden work and ignores its late response", async () => {
  let done!: (value: RichPreviewResult) => void;
  const render = vi.fn((_request: RichPreviewRequest, _signal: AbortSignal) => new Promise<RichPreviewResult>(resolve => { done = resolve; }));
  const { view } = editor("$x$", render);
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  view.dispatch({ effects: settings.reconfigure(livePreviewSettings.of({ hideSyntax: true, highContrastMarkers: false, sourceMode: true })) });
  expect(render.mock.calls[0]![1].aborted).toBe(true);
  done({ html: "<math><mi>late</mi></math>" }); await Promise.resolve(); await Promise.resolve();
  expect(frame(view)).toBeNull(); expect(view.contentDOM.textContent).toContain("$x$");
});

it("does no rendering for source mode, currency, incomplete fences or literal code/HTML/YAML", async () => {
  const { view, create, render } = editor('---\nvalue: "$x$"\n---\n\nCosts $20 and $30.\n\n`$x$`\n\n```tex\n$x$\n```\n\n<div>\n$x$\n</div>\n\n$$\nunfinished');
  await new Promise(resolve => setTimeout(resolve, 40)); expect(create).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "$real$\n\nActive" }, selection: { anchor: 14 }, effects: settings.reconfigure(livePreviewSettings.of({ hideSyntax: true, highContrastMarkers: false, sourceMode: true })) });
  await new Promise(resolve => setTimeout(resolve, 40)); expect(render).not.toHaveBeenCalled();
});

it("keeps quote/list prefixes out of the rendered math body", async () => {
  const { render } = editor("> $$\n> x\n>\n> y\n> $$\n\n- $$\n  z\n  $$");
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
  expect(render.mock.calls.map(([request]) => request.body)).toEqual(["x\n\ny", "z"]);
});

it.each([
  ["> Before $x\n> +y$ after", "x\n+y"],
  ["- Before $x\n  +y$ after", "x\n+y"],
  ["> - Before $x\n>   +y$ after", "x\n+y"],
  ["> Before $x\n+y$ after", "x\n+y"],
  ["Before $x\n  +y$ after", "x\n  +y"],
])("keeps structural continuation prefixes out of inline TeX while preserving actual indentation: %j", async (source, body) => {
  const { render } = editor(source!); await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  expect(render.mock.calls[0]![0].body).toBe(body);
});

it("retains semantic table cells and reveals every preview in an active table", async () => {
  const { view } = editor("|$a$| Other |\n|---|---|\n|$b$| Text |");
  await vi.waitFor(() => expect(view.dom.querySelectorAll('[role="table"] .cm-slate-rich-preview')).toHaveLength(2));
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("Text") + 1 } });
  expect(frame(view)).toBeNull(); expect(view.contentDOM.textContent).toContain("$a$"); expect(undo(view)).toBe(false);
});

it("reuses a rendered frame as source positions move, and updates the source control", async () => {
  const { view, render } = editor("Prefix\n\n$x$" );
  await vi.waitFor(() => expect(frame(view)).not.toBeNull()); const first = frame(view);
  view.dispatch({ changes: { from: 0, insert: "More " } });
  await new Promise(resolve => setTimeout(resolve, 40)); expect(frame(view)).toBe(first); expect(render).toHaveBeenCalledTimes(1);
  view.dom.querySelector<HTMLButtonElement>('button[aria-label="Show math source"]')!.click();
  expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf("$x$") + 1);
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe("Prefix\n\n$x$\n\nActive");
});

it("rerenders on theme changes while retaining the editor and Undo history", async () => {
  const { view, render } = editor("$x$");
  await vi.waitFor(() => expect(frame(view)).not.toBeNull()); const original = view.state.doc;
  document.documentElement.dataset.theme = "dark";
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
  expect(render.mock.calls[1]![0].theme).toBe("dark"); expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it("leaves a readable source control after rendering fails and disposes its session", async () => {
  const { view, destroy } = editor("$bad$", vi.fn(async () => { throw Error('<script>unsafe</script>'); }));
  await vi.waitFor(() => expect(view.dom.querySelector(".cm-slate-rich-status")?.textContent).toBe("Math preview unavailable"));
  expect(frame(view)).toBeNull(); expect(view.dom.querySelector("script")).toBeNull();
  const parent = view.dom.parentElement; view.destroy(); views.splice(views.indexOf(view), 1); parent?.remove(); expect(destroy).toHaveBeenCalledTimes(1);
});
