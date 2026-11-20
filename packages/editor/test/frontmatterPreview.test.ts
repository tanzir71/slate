import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forceParsing } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import { afterEach, expect, it, vi } from "vitest";
import { createSlateMarkdownExtensions, livePreviewSettings } from "../src/index";
import { frontmatterPreviewState } from "../src/frontmatterPreview";

const frontmatter = "---\nstatus: Draft\ntags: [strategy, planning]\ngoal: 1500\nupdated: 2026-11-17T12:00:00Z\n---";
const views: EditorView[] = [], settings = new Compartment();
function editor(prefix: string, readOnly = false) {
  const doc = prefix + "\n\n# Body\n\nActive.";
  const view = new EditorView({ parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [createSlateMarkdownExtensions(), settings.of([]), EditorState.readOnly.of(readOnly)] }),
  });
  views.push(view); forceParsing(view, doc.length, 1_000); return view;
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const view of views.splice(0)) { const parent = view.dom.parentElement; view.destroy(); parent?.remove(); } });

it("projects actual YAML properties into the light/dark design row without touching source or history", () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-17T12:02:00Z"));
  const view = editor(frontmatter), original = view.state.doc;
  const row = view.dom.querySelector(".cm-slate-properties")!;
  expect(row).not.toBeNull();
  expect(Array.from(row.querySelectorAll(".cm-slate-property-key"), key => key.textContent)).toEqual(["status", "tags", "goal", "updated"]);
  expect(Array.from(row.querySelectorAll(".cm-slate-property-value"), value => value.textContent)).toEqual(["Draft", "#strategy  #planning", "1,500 words", "2 min ago"]);
  expect(row.textContent).not.toContain("---");
  expect(row.querySelectorAll(".cm-slate-property-add img")).toHaveLength(2);
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it("keeps a fresh unfocused note in Live preview even with its default caret at zero, then exposes focused YAML", async () => {
  const view = editor(frontmatter), original = view.state.doc;
  view.dispatch({ selection: { anchor: 0 } });
  expect(view.dom.querySelector(".cm-slate-properties")).not.toBeNull();
  view.focus();
  await vi.waitFor(() => expect(view.dom.querySelector(".cm-slate-properties")).toBeNull());
  expect(view.contentDOM.textContent).toContain("status: Draft");
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it("opens the original YAML value from a property chip with no edit or Undo entry", () => {
  const view = editor(frontmatter), original = view.state.doc;
  view.dom.querySelector<HTMLButtonElement>('.cm-slate-property[data-key="status"]')!.click();
  expect(view.dom.querySelector(".cm-slate-properties")).toBeNull();
  expect(view.state.selection.main.head).toBe(frontmatter.indexOf("Draft"));
  expect(document.activeElement).toBe(view.contentDOM);
  expect(view.contentDOM.textContent).toContain("status: Draft");
  view.dispatch({ selection: { anchor: original.length } });
  expect(view.dom.querySelector(".cm-slate-properties")).not.toBeNull();
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it.each(["", "property: kept\n"])("adds one unique empty property and selects its name without overwriting %j", existing => {
  const prefix = "---\n# Keep this comment\nstatus: 'Draft' # keep\n" + existing + "---", view = editor(prefix);
  const original = view.state.doc, key = existing ? "property2" : "property";
  view.dom.querySelector<HTMLButtonElement>(".cm-slate-property-add")!.click();
  const at = prefix.lastIndexOf("---");
  expect(view.state.doc.toString()).toBe(original.toString().slice(0, at) + `${key}: \n` + original.toString().slice(at));
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(key);
  expect(document.activeElement).toBe(view.contentDOM);
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(original.toString());
  expect(undo(view)).toBe(false);
});

it("allows read-only source inspection while disabling property insertion", () => {
  const view = editor(frontmatter, true), original = view.state.doc;
  const add = view.dom.querySelector<HTMLButtonElement>(".cm-slate-property-add")!;
  expect(add.disabled).toBe(true); add.click(); expect(view.state.doc).toBe(original);
  view.dom.querySelector<HTMLButtonElement>('.cm-slate-property[data-key="status"]')!.click();
  expect(view.dom.querySelector(".cm-slate-properties")).toBeNull();
  expect(view.state.selection.main.head).toBe(frontmatter.indexOf("Draft"));
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it.each([true, false])("leaves all YAML literal with Source mode or visible syntax (sourceMode %s)", sourceMode => {
  const view = editor(frontmatter), original = view.state.doc;
  expect(view.dom.querySelector(".cm-slate-properties")).not.toBeNull();
  view.dispatch({ effects: settings.reconfigure(livePreviewSettings.of({ sourceMode, hideSyntax: sourceMode, highContrastMarkers: true })) });
  expect(view.dom.querySelector(".cm-slate-properties")).toBeNull();
  expect(view.contentDOM.textContent).toContain("tags: [strategy, planning]");
  expect(view.state.doc).toBe(original);
});

it("recognizes BOM and the YAML document-end closing marker", () => {
  const raw = "\uFEFF---\nstatus: Draft\n...", view = editor(raw);
  expect(view.dom.querySelector(".cm-slate-property-value")?.textContent).toBe("Draft");
  expect(view.state.doc.toString()).toBe(raw + "\n\n# Body\n\nActive.");
});

it("renders strings as text and leaves nested values accessible in source", () => {
  const view = editor("---\ntitle: '<img src=x onerror=alert(1)>'\noptions: {nested: true}\n---");
  expect(view.dom.querySelector('.cm-slate-property[data-key="title"] .cm-slate-property-value')?.textContent).toBe("<img src=x onerror=alert(1)>");
  expect(view.dom.querySelectorAll("img[onerror], script, iframe")).toHaveLength(0);
  view.dom.querySelector<HTMLButtonElement>('.cm-slate-property[data-key="options"]')!.click();
  expect(view.contentDOM.textContent).toContain("options: {nested: true}");
});

it("lets an empty valid frontmatter mapping create its first property", () => {
  const view = editor("---\n---");
  expect(view.dom.querySelectorAll(".cm-slate-property")).toHaveLength(0);
  const add = view.dom.querySelector<HTMLButtonElement>(".cm-slate-property-add")!;
  expect(add).not.toBeNull(); add.click();
  expect(view.state.doc.toString()).toContain("---\nproperty: \n---");
});

it("caches header parsing and retains focused controls during ordinary body edits", () => {
  const view = editor(frontmatter), model = view.state.field(frontmatterPreviewState).header?.model;
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-slate-property-add")!;
  button.focus();
  view.dispatch({ changes: { from: view.state.doc.length, insert: " More body." } });
  expect(view.state.field(frontmatterPreviewState).header?.model).toBe(model);
  expect(view.dom.querySelector(".cm-slate-property-add")).toBe(button);
  expect(document.activeElement).toBe(button);
});

it("isolates property insertion from adjacent typing history", () => {
  const view = editor(frontmatter), original = view.state.doc.toString();
  view.dispatch({ changes: { from: view.state.doc.length, insert: "!" }, annotations: Transaction.userEvent.of("input.type") });
  const typed = view.state.doc.toString();
  view.dom.querySelector<HTMLButtonElement>(".cm-slate-property-add")!.click();
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(typed);
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(original);
});

it("ignores detached property controls after source or editor settings change", () => {
  const view = editor(frontmatter), oldAdd = view.dom.querySelector<HTMLButtonElement>(".cm-slate-property-add")!;
  const at = frontmatter.indexOf("Draft");
  view.dispatch({ changes: { from: at, to: at + 5, insert: "Ready" } });
  const current = view.state.doc;
  expect(oldAdd.isConnected).toBe(false); oldAdd.click(); expect(view.state.doc).toBe(current);
  const add = view.dom.querySelector<HTMLButtonElement>(".cm-slate-property-add")!;
  view.dispatch({ effects: settings.reconfigure(livePreviewSettings.of({ sourceMode: true, hideSyntax: true, highContrastMarkers: false })) });
  expect(add.isConnected).toBe(false); add.click(); expect(view.state.doc).toBe(current);
});

it("refreshes relative timestamps without replacing controls, changing source or adding history", () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-11-17T12:02:00Z"));
  const view = editor(frontmatter), original = view.state.doc;
  const button = view.dom.querySelector<HTMLButtonElement>('.cm-slate-property[data-key="updated"]')!;
  const value = button.querySelector(".cm-slate-property-value")!;
  expect(value.textContent).toBe("2 min ago");
  vi.advanceTimersByTime(60_001);
  expect(value.textContent).toBe("3 min ago");
  expect(view.dom.querySelector('.cm-slate-property[data-key="updated"]')).toBe(button);
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
  view.dispatch({ effects: settings.reconfigure(livePreviewSettings.of({ sourceMode: true, hideSyntax: true, highContrastMarkers: false })) });
  vi.advanceTimersByTime(120_001);
  expect(value.textContent).toBe("3 min ago");
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it("keeps a pooled view clock alive across detachment without changing source", () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-11-17T12:02:00Z"));
  const view = editor(frontmatter), original = view.state.doc, parent = view.dom.parentElement!;
  const value = view.dom.querySelector('.cm-slate-property[data-key="updated"] .cm-slate-property-value')!;
  parent.remove(); vi.advanceTimersByTime(60_001);
  expect(value.textContent).toBe("2 min ago");
  document.body.append(parent); vi.advanceTimersByTime(60_001);
  expect(value.textContent).toBe("4 min ago");
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});

it("keeps an oversized header literal while identifying its body without copying the long value", () => {
  const prefix = "---\nvalue: " + "x".repeat(70_000) + "\n---", doc = prefix + "\n\n# Body";
  const state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [frontmatterPreviewState] });
  expect(state.field(frontmatterPreviewState).decorations.size).toBe(0);
  expect(state.field(frontmatterPreviewState).header?.end).toBe(prefix.length);
  expect(state.doc.toString()).toBe(doc);
});

it("bounds unfinished-header scanning and caches it during tail typing", () => {
  const doc = "---\n" + "# Keep\n".repeat(2_200) + "Unfinished";
  const state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [frontmatterPreviewState] });
  const transaction = state.update({ changes: { from: doc.length, insert: "!" } });
  const line = vi.spyOn(transaction.newDoc, "line");
  const next = transaction.state.field(frontmatterPreviewState);
  expect(line).not.toHaveBeenCalled();
  expect(next.header?.end).toBe(doc.length + 1);
  expect(next.decorations.size).toBe(0);
});

it.each([
  "# Literal\n\n---\nstatus: Draft\n---", "```yaml\n---\nstatus: Draft\n---\n```",
  "---\nstatus: [unfinished\n---", "---\nstatus: one\nstatus: two\n---",
  "---\n- sequence\n- root\n---", "---\nbase: &base {nested: value}\ncopy: *base\n---",
  "---\nstatus: Draft", "---\nvalue: !unknown raw\n---",
])("keeps excluded or unsupported frontmatter literal and unchanged: %j", raw => {
  const view = editor(raw), original = view.state.doc;
  expect(view.dom.querySelector(".cm-slate-properties")).toBeNull();
  expect(view.state.doc.toString()).toBe(raw + "\n\n# Body\n\nActive.");
  expect(view.state.doc).toBe(original); expect(undo(view)).toBe(false);
});
