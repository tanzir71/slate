import { undo } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { createSlateMarkdownExtensions, livePreviewSettings } from "../src/index";
import { imagePreviewLoader, type LoadPreviewImage } from "../src/imagePreview";

const views: EditorView[] = [], settings = new Compartment();
const createURL = vi.fn(() => "blob:slate-image-test"), revokeURL = vi.fn();
function editor(source: string, loader: LoadPreviewImage, readOnly = false) {
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createURL; static revokeObjectURL = revokeURL; });
  const doc = source + "\n\nActive";
  const view = new EditorView({ parent: document.body.appendChild(document.createElement("div")), state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [createSlateMarkdownExtensions(), imagePreviewLoader.of(loader), settings.of([]), EditorState.readOnly.of(readOnly)] }) });
  views.push(view); forceParsing(view, doc.length, 1_000); return view;
}
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
const image = (view: EditorView) => view.dom.querySelector<HTMLImageElement>(".cm-slate-image-preview img");
afterEach(() => { for (const view of views.splice(0)) { const host = view.dom.parentElement; view.destroy(); host?.remove(); } vi.unstubAllGlobals(); createURL.mockClear(); revokeURL.mockClear(); });

it.each([false, true])("shows an inline local image and inert alt caption without changing source or Undo (readOnly %s)", async readOnly => {
  const load = vi.fn(async () => png()), view = editor('![Diagram <safe>](./assets/diagram.png "Title")', load, readOnly), original = view.state.doc;
  await vi.waitFor(() => expect(image(view)?.getAttribute("src")).toBe("blob:slate-image-test"));
  expect(image(view)!.alt).toBe("Diagram <safe>");
  expect(view.dom.querySelector(".cm-slate-image-caption")?.textContent).toBe("Diagram <safe>");
  expect(view.dom.querySelector(".cm-slate-image-preview safe")).toBeNull();
  expect(load).toHaveBeenCalledExactlyOnceWith("./assets/diagram.png", expect.any(AbortSignal));
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it("exposes the unchanged source by keyboard activation and immediately releases the image", async () => {
  const source = "![Diagram](./assets/a.png)", view = editor(source, async () => png()), original = view.state.doc;
  await vi.waitFor(() => expect(image(view)).not.toBeNull());
  view.dom.querySelector<HTMLButtonElement>(".cm-slate-image-preview")!.click();
  expect(image(view)).toBeNull(); expect(view.contentDOM.textContent).toContain(source);
  expect(view.state.selection.main.head).toBe(2); expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
  expect(revokeURL).toHaveBeenCalledExactlyOnceWith("blob:slate-image-test");
});

it("keeps source mode and disabled syntax free of asset reads", async () => {
  const load = vi.fn(async () => png()), view = editor("![Diagram](./assets/a.png)", load);
  view.dispatch({ effects: settings.reconfigure(livePreviewSettings.of({ hideSyntax: true, highContrastMarkers: false, sourceMode: true })) });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(image(view)).toBeNull(); expect(load).not.toHaveBeenCalled();
  view.dispatch({ effects: settings.reconfigure(livePreviewSettings.of({ hideSyntax: false, highContrastMarkers: false })) });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(image(view)).toBeNull(); expect(load).not.toHaveBeenCalled();
});

it("keeps code, HTML and frontmatter image-like text literal", async () => {
  const load = vi.fn(async () => png());
  const view = editor('---\ncover: "![x](a.png)"\n---\n\n`![x](a.png)`\n\n```md\n![x](a.png)\n```\n\n<div>![x](a.png)</div>', load);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(image(view)).toBeNull(); expect(load).not.toHaveBeenCalled();
});

it("resolves a reference image and a multiline alt from the original definition without editing", async () => {
  const load = vi.fn(async () => png()), source = "![First\nsecond][cover]\n\n[cover]: <./assets/a%20b.png> \"Title\"";
  const view = editor(source, load), original = view.state.doc;
  await vi.waitFor(() => expect(image(view)).not.toBeNull());
  expect(image(view)!.alt).toBe("First\nsecond");
  expect(load).toHaveBeenCalledExactlyOnceWith("./assets/a%20b.png", expect.any(AbortSignal));
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it("reuses the same image and read when typing before it moves its source position", async () => {
  const load = vi.fn(async () => png()), view = editor("Prefix\n\n![Diagram](./assets/a.png)", load);
  await vi.waitFor(() => expect(image(view)).not.toBeNull());
  const originalImage = image(view);
  view.dispatch({ changes: { from: 0, insert: "More " } });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(image(view)).toBe(originalImage); expect(load).toHaveBeenCalledTimes(1); expect(createURL).toHaveBeenCalledTimes(1);
  view.dom.querySelector<HTMLButtonElement>(".cm-slate-image-preview")!.click();
  expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf("![") + 2);
});

it("aborts a detached preview and never creates a URL for late bytes", async () => {
  let resolve!: (value: Blob) => void;
  const load = vi.fn((_destination: string, _signal: AbortSignal) => new Promise<Blob>(done => { resolve = done; }));
  const view = editor("![Diagram](./assets/a.png)", load);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  view.dispatch({ effects: settings.reconfigure(livePreviewSettings.of({ hideSyntax: true, highContrastMarkers: false, sourceMode: true })) });
  expect(load.mock.calls[0]![1].aborted).toBe(true);
  resolve(png()); await Promise.resolve(); await Promise.resolve();
  expect(createURL).not.toHaveBeenCalled(); expect(image(view)).toBeNull();
});

it.each(["![Cover][]", "![Cover]", "![Escaped][A\\! B]"])("resolves collapsed, shortcut and escaped reference labels: %s", async source => {
  const definition = source.includes("Escaped") ? "[a\\! b]: ./assets/first.png" : "[cover]: ./assets/first.png";
  const load = vi.fn(async () => png()), view = editor(source + "\n\n" + definition + "\n[cover]: ./assets/second.png", load);
  await vi.waitFor(() => expect(image(view)).not.toBeNull());
  expect(load).toHaveBeenCalledExactlyOnceWith("./assets/first.png", expect.any(AbortSignal));
});

it.each([undefined, new Blob(["plain"], { type: "text/plain" })])("keeps an unavailable or non-image result as an accessible source control", async result => {
  const view = editor("![Missing](./assets/a.png)", async () => result), original = view.state.doc;
  await vi.waitFor(() => expect(view.dom.querySelector(".cm-slate-image-status")?.textContent).toBe("Image unavailable"));
  expect(createURL).not.toHaveBeenCalled(); expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
  view.dom.querySelector<HTMLButtonElement>(".cm-slate-image-preview")!.click();
  expect(view.contentDOM.textContent).toContain("![Missing](./assets/a.png)");
});

it("revokes a failed image URL once and still exposes source", async () => {
  const view = editor("![Broken](./assets/a.png)", async () => png());
  await vi.waitFor(() => expect(image(view)).not.toBeNull());
  image(view)!.dispatchEvent(new Event("error"));
  expect(image(view)).toBeNull(); expect(revokeURL).toHaveBeenCalledExactlyOnceWith("blob:slate-image-test");
  expect(view.dom.querySelector(".cm-slate-image-status")?.textContent).toBe("Image unavailable");
  view.dom.querySelector<HTMLButtonElement>(".cm-slate-image-preview")!.click();
  expect(revokeURL).toHaveBeenCalledTimes(1);
});

it.each([
  ['[![Cover](./assets/a.png)](<https://link.invalid/target> "Title")', "https://link.invalid/target"],
  ["[![Cover](./assets/a.png)][go]\n\n[go]: https://link.invalid/target", "https://link.invalid/target"],
  ["[![Cover](./assets/a.png)](javascript:alert(1))", null],
])("preserves only a safe enclosing link on the replacement image control: %s", async (source, destination) => {
  const view = editor(source!, async () => png());
  await vi.waitFor(() => expect(image(view)).not.toBeNull());
  expect(view.dom.querySelector(".cm-slate-image-preview")!.getAttribute("data-slate-href")).toBe(destination);
  expect(view.dom.querySelector(".cm-slate-image-preview")!.classList.contains("cm-slate-link")).toBe(destination !== null);
});
